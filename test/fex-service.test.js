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
const { FexService } = require('../background.js');

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
});
