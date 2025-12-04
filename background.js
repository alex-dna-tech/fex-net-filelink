// Anonymous FEX.net service client
class FexService {
  constructor(windowId) {
    this.windowId = windowId.toString();
    this.API_BASE = "https://api.fex.net/api/v1";
    this.state = {
      token: null,
      root_id: null,
      root_exp: null,
      files: [],
    };
    this.initPromise = Promise.resolve();
    this.tokenPromise = null;
  }

  async loadState() {
    const data = await browser.storage.local.get(this.windowId);
    if (data[this.windowId]) {
      this.state = data[this.windowId];
    }
  }

  async saveState() {
    await browser.storage.local.set({ [this.windowId]: this.state });
  }

  _parseJwt(token) {
    var base64Url = token.split(".")[1];
    var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    var jsonPayload = decodeURIComponent(
      window
        .atob(base64)
        .split("")
        .map(function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );

    return JSON.parse(jsonPayload);
  }

  _isTokenExpired(token) {
    try {
      const payload = this._parseJwt(token);
      if (!payload.exp) {
        return true;
      }
      return payload.exp < Date.now() / 1000;
    } catch (e) {
      // consider invalid tokens as expired
      return true;
    }
  }

  async _getUploadToken() {
    const storedToken = this.state.token;

    if (
      storedToken &&
      storedToken.value &&
      storedToken.exp > Date.now() / 1000
    ) {
      return;
    }

    if (this.tokenPromise) {
      return this.tokenPromise;
    }

    this.tokenPromise = (async () => {
      try {
        const response = await fetch(`${this.API_BASE}/anonymous/upload-token`);
        const responseData = await response.json();
        const token = responseData.token;
        const payload = this._parseJwt(token);
        this.state.token = {
          value: token,
          exp: payload.exp,
          iat: payload.iat,
          uk: payload.uk,
        };
      } finally {
        this.tokenPromise = null;
      }
    })();
    return this.tokenPromise;
  }

  _initUploadResource(fileInfo) {
    const result = this.initPromise.then(() =>
      this._doInitUploadResource(fileInfo),
    );
    this.initPromise = result.catch(() => {});
    return result;
  }

  async _doInitUploadResource(fileInfo) {
    // Initiate file upload to get upload location
    const initResponse = await fetch(`${this.API_BASE}/anonymous/file`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.state.token.value}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory_id: null,
        anon_upload_root_id: this.state.root_id,
        size: fileInfo.data.size,
        name: fileInfo.name,
      }),
    });
    const initData = await initResponse.json();
    if (initData.anon_upload_root_id && !this.state.root_id) {
      this.state.root_id = initData.anon_upload_root_id;
      this.state.root_exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
    }

    return {
      uploadUrl: initData.location,
      fileKey: initData.anon_upload_link,
    };
  }

  async _createResourceFile(uploadUrl, fileInfo) {
    // Create upload resource on storage server
    const createResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.state.token.value}`,
        "fsp-filename": encodeURIComponent(fileInfo.name),
        "fsp-size": fileInfo.data.size.toString(),
        "fsp-version": "1.0.0",
      },
    });
    if (createResponse.status !== 201) {
      throw new Error(
        `Failed to create upload resource: status ${
          createResponse.status
        }, response: ${await createResponse.text()}`,
      );
    }
  }

  async _uploadResourceFileByChunks(uploadUrl, fileInfo) {
    // Upload file content
    const CHUNK_SIZE = 4 * 1024 * 1024;
    for (let offset = 0; offset < fileInfo.data.size; offset += CHUNK_SIZE) {
      const chunk = fileInfo.data.slice(offset, offset + CHUNK_SIZE);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${this.state.token.value}`,
          "content-type": "application/offset+octet-stream",
          "fsp-offset": offset.toString(),
          "fsp-version": "1.0.0",
        },
        body: chunk,
      });

      const isLastChunk = offset + chunk.size >= fileInfo.data.size;

      // Return status "No content" for intermediate chunks,
      // and 200 OK or 204 No Content for the last chunk.
      if (isLastChunk) {
        if (uploadResponse.status !== 200 && uploadResponse.status !== 204) {
          throw new Error(
            `Upload failed: ${
              uploadResponse.status
            }, response: ${await uploadResponse.text()}`,
          );
        }
      } else if (uploadResponse.status !== 204) {
        throw new Error(
          `Upload failed: ${
            uploadResponse.status
          }, response: ${await uploadResponse.text()}`,
        );
      }
    }
  }

  async uploadFile(fileInfo) {
    console.log("uploadFile function:", fileInfo);
    await this._getUploadToken();

    const { uploadUrl, fileKey } = await this._initUploadResource(fileInfo);
    if (!uploadUrl || !fileKey) {
      throw new Error("Failed to get upload URL or file key.");
    }
    await this._createResourceFile(uploadUrl, fileInfo);
    await this._uploadResourceFileByChunks(uploadUrl, fileInfo);

    const url = `https://fex.net/s/${fileKey}`;
    this.state.files.push({
      id: fileInfo.id,
      name: fileInfo.name,
      size: fileInfo.data.size,
      fileKey: fileKey,
      url: url,
    });

    return { url };
  }
}

const fexServicePromises = new Map();

browser.cloudFile.onFileUpload.addListener(
  async (account, fileInfo, tab, relatedFileInfo) => {
    console.log(
      "onFileUpload listener",
      account,
      fileInfo,
      tab,
      relatedFileInfo,
    );

    let servicePromise = fexServicePromises.get(tab.windowId);
    if (!servicePromise) {
      const service = new FexService(tab.windowId);
      servicePromise = service.loadState().then(() => service);
      fexServicePromises.set(tab.windowId, servicePromise);
    }
    const fexService = await servicePromise;

    try {
      const result = await fexService.uploadFile(fileInfo);
      await fexService.saveState();
      return result;
    } catch (e) {
      console.error("Upload failed:", e);
      return { error: e.message || true };
    }
  },
);

browser.cloudFile.onAccountAdded.addListener(async (account) => {
  await browser.cloudFile.updateAccount(account.id, { configured: true });
  console.log("onAccountAdded", account);
});

browser.cloudFile.onAccountDeleted.addListener((account) => {
  console.log("onAccountDeleted", account);
});

browser.cloudFile.onFileDeleted.addListener((account, fileId, tab) => {
  console.log("onFileDeleted", account, fileId, tab);
});

browser.cloudFile.onFileRename.addListener((account, fileId, newName, tab) => {
  console.log("onFileRename", account, fileId, newName, tab);
});

browser.cloudFile.onFileUploadAbort.addListener((account, fileId, tab) => {
  console.log("onFileUploadAbort ", account, fileId, tab);
});
