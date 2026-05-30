const fs = require('fs');
const path = require('path');

// Mock browser API
global.browser = {
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue({}),
    }
  },
  runtime: {
    getManifest: jest.fn().mockReturnValue({ host_permissions: [] }),
    onConnect: { addListener: jest.fn() },
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn().mockResolvedValue({}),
  },
  permissions: {
    contains: jest.fn().mockResolvedValue(true),
  },
  cloudFile: {
    onFileUpload: { addListener: jest.fn() },
    onAccountAdded: { addListener: jest.fn() },
    onFileDeleted: { addListener: jest.fn() },
    onFileRename: { addListener: jest.fn() },
    onFileUploadAbort: { addListener: jest.fn() },
    getAllAccounts: jest.fn().mockResolvedValue([]),
    updateAccount: jest.fn().mockResolvedValue({}),
  }
};

// Mock window and atob
global.window = {
  atob: (str) => Buffer.from(str, 'base64').toString('binary'),
};

// Mock fetch
global.fetch = jest.fn();

// Load FexService
const { FexService, handleClearAllUploads } = require('../background.js');

describe('FexService', () => {
  let service;
  const windowId = '123';

  // Capture listener from the mock call during module load
  const onFileDeletedListener = global.browser.cloudFile.onFileDeleted.addListener.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FexService(windowId);
  });

  test('uploadFile stores fexId and parentId', async () => {
    const fileInfo = {
      id: 'tb-file-1',
      name: 'test.txt',
      data: { size: 100, slice: jest.fn().mockReturnValue({ size: 100 }) }
    };

    const tokenPayload = { exp: Math.floor(Date.now() / 1000) + 3600, iat: 123, uk: 'uk' };
    const token = 'header.' + Buffer.from(JSON.stringify(tokenPayload)).toString('base64') + '.signature';

    // Mock responses
    fetch
      .mockResolvedValueOnce({ // _getUploadToken
        ok: true,
        json: async () => ({ token })
      })
      .mockResolvedValueOnce({ // _doInitUploadResource
        ok: true,
        json: async () => ({
          id: 555,
          location: 'https://upload.fex.net/1',
          anon_upload_link: 'abcde',
          anon_upload_root_id: 444
        })
      })
      .mockResolvedValueOnce({ // _createResourceFile
        status: 201
      })
      .mockResolvedValueOnce({ // _uploadResourceFileByChunks
        status: 200,
        json: async () => ({ id: 555 })
      });

    await service.uploadFile(fileInfo);

    const storedFile = service.state.files.find(f => f.id === 'tb-file-1');
    expect(storedFile).toBeDefined();
    expect(storedFile.fexId).toBe(555);
    expect(storedFile.parentId).toBe(444);
  });

  test('deleteFile sends correct API request and removes file from state', async () => {
    // Setup state with a file
    service.state.files = [{
      id: 'tb-file-1',
      fexId: 555,
      parentId: 444
    }];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' })
    });

    await service.deleteFile('tb-file-1');

    // Verify fetch call
    expect(fetch).toHaveBeenCalledWith('https://api.fex.net/api/v1/file/delete/', {
      method: 'DELETE',
      headers: {
        'authorization': 'Bearer test-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        files_ids: [555],
        parent_id: 444
      })
    });

    // Verify state cleanup
    expect(service.state.files).toHaveLength(0);
    expect(global.browser.storage.local.set).toHaveBeenCalled();
  });

  test('onFileDeleted listener calls deleteFile', async () => {
    const account = {};
    const fileId = 'tb-file-1';
    const tab = { windowId: '123' };

    // Mock deleteFile on the instance that will be created
    const deleteFileSpy = jest.spyOn(FexService.prototype, 'deleteFile').mockResolvedValue();

    await onFileDeletedListener(account, fileId, tab);

    expect(deleteFileSpy).toHaveBeenCalledWith(fileId);
    deleteFileSpy.mockRestore();
  });

  test('deleteFile does not send API request when fexId is undefined', async () => {
    service.state.files = [{
      id: 'tb-file-1',
      name: 'test.txt',
      fexId: undefined,
      parentId: 444
    }];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    await service.deleteFile('tb-file-1');

    expect(fetch).not.toHaveBeenCalled();
  });

  test('deleteFile does not send API request when fexId is null', async () => {
    service.state.files = [{
      id: 'tb-file-1',
      name: 'test.txt',
      fexId: null,
      parentId: 444
    }];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    await service.deleteFile('tb-file-1');

    expect(fetch).not.toHaveBeenCalled();
  });

  test('batches sibling files in same parent into single delete call', async () => {
    service.state.files = [
      { id: 'tb-file-1', fexId: 555, parentId: 444 },
      { id: 'tb-file-2', fexId: 556, parentId: 444 }
    ];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: 'ok' }) });

    await service.deleteFile('tb-file-1');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.fex.net/api/v1/file/delete/',
      expect.objectContaining({
        body: JSON.stringify({ files_ids: [555, 556], parent_id: 444 }),
      }),
    );
    expect(service.state.files).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('second deleteFile is no-op after batch already removed siblings', async () => {
    service.state.files = [
      { id: 'tb-file-1', fexId: 555, parentId: 444 },
      { id: 'tb-file-2', fexId: 556, parentId: 444 }
    ];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });

    await service.deleteFile('tb-file-1');
    await service.deleteFile('tb-file-2');

    expect(service.state.files).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('handleClearAllUploads calls clearAllUploads for each window with files', async () => {
  global.browser.storage.local.get.mockResolvedValueOnce({
    '123': {
      token: { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 },
      root_id: 444,
      root_exp: Date.now() + 3600000,
      files: [{ id: 'tb-file-1', fexId: 555, parentId: 444 }],
    },
    '456': {
      token: { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 },
      root_id: 777,
      root_exp: Date.now() + 3600000,
      files: [{ id: 'tb-file-2', fexId: 556, parentId: 777 }],
    },
  });

  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });

  await handleClearAllUploads();

  expect(fetch).toHaveBeenCalledTimes(2);
});

test('clearAllUploads skips API calls when expired and resets state', async () => {
  service.state.files = [
    { id: 'tb-file-1', fexId: 555, parentId: 444 },
  ];
  service.state.root_id = 444;
  service.state.root_exp = Date.now() - 1000;

  await service.clearAllUploads();

  expect(fetch).not.toHaveBeenCalled();
  expect(service.state.files).toHaveLength(0);
  expect(service.state.root_id).toBeNull();
  expect(service.state.root_exp).toBeNull();
  expect(global.browser.storage.local.set).toHaveBeenCalled();
});

test('clearAllUploads deletes all files grouped by parentId and resets state', async () => {
  service.state.files = [
    { id: 'tb-file-1', fexId: 555, parentId: 444 },
    { id: 'tb-file-2', fexId: 556, parentId: 444 },
    { id: 'tb-file-3', fexId: 557, parentId: 777 },
  ];
  service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };
  service.state.root_id = 444;
  service.state.root_exp = Date.now() + 3600000;

  fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });

  await service.clearAllUploads();

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith(
    'https://api.fex.net/api/v1/file/delete/',
    expect.objectContaining({
      body: JSON.stringify({ files_ids: [555, 556], parent_id: 444 }),
    }),
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://api.fex.net/api/v1/file/delete/',
    expect.objectContaining({
      body: JSON.stringify({ files_ids: [557], parent_id: 777 }),
    }),
  );
  expect(service.state.files).toHaveLength(0);
  expect(service.state.root_id).toBeNull();
  expect(service.state.root_exp).toBeNull();
  expect(global.browser.storage.local.set).toHaveBeenCalled();
});

test('saveState does not lose data when concurrent deletions race', async () => {
    let resolveFirst, resolveSecond;
    const first = new Promise(r => { resolveFirst = r; });
    const second = new Promise(r => { resolveSecond = r; });

    const fakeStore = {};
    let callCount = 0;

    global.browser.storage.local.set.mockImplementation(async (data) => {
      const key = Object.keys(data)[0];
      const snapshot = JSON.parse(JSON.stringify(data[key]));
      callCount++;
      const gate = callCount === 1 ? first : second;
      await gate;
      fakeStore[key] = snapshot;
    });

    service.state.files = [
      { id: 'tb-file-1', fexId: 555, parentId: 444 },
      { id: 'tb-file-2', fexId: 556, parentId: 444 }
    ];
    service.state.token = { value: 'test-token', exp: Math.floor(Date.now() / 1000) + 3600 };

    fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });

    const deletePromise = Promise.all([
      service.deleteFile('tb-file-1'),
      service.deleteFile('tb-file-2')
    ]);

    // Both deleteFile calls batch all siblings. Both response handlers run and
    // call saveState. The queue serializes writes — only first set is called.
    await new Promise(r => setTimeout(r, 5));
    expect(callCount).toBe(1);

    resolveFirst();
    await new Promise(r => setTimeout(r, 5));
    expect(callCount).toBe(2);

    resolveSecond();
    await deletePromise;

    expect(service.state.files).toHaveLength(0);
    expect(fakeStore['123'].files).toHaveLength(0);
  });
});
