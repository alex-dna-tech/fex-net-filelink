# FEX.net File Link Webextension for Thunderbird

Easily upload large attachments anonymously to [FEX.net](https://fex.net/support) using the [cloudFile/filelink API](https://thunderbird-webextensions.readthedocs.io/en/latest/cloudFile.html) — fast, secure, and hassle-free.

## How it Works

This extension integrates with Thunderbird's Filelink feature, first introduced in Thunderbird v64, to handle large attachments. Instead of attaching a large file directly to an email, Thunderbird uploads the file to FEX.net and inserts a link into the email body.

FEX.net provides free temporary file storage with [Privacy Policy](https://fex.net/privacy-policy). Files are stored anonymously and are available via a public link for a limited time. This extension does not use cookies for tracking anonymous uploads.

### Upload Process

The following diagram illustrates the data exchange between the Thunderbird extension and the FEX.net REST API during the file upload. Each network request is performed using `fetch` in `background.js`.

```mermaid
sequenceDiagram
    participant TB as Thunderbird Extension
    participant FEX_API as FEX.net API Server
    participant FEX_Storage as FEX.net Storage Server

    TB->>FEX_API: GET /api/v1/anonymous/upload-token<br/>(fetch)
    activate FEX_API
    FEX_API-->>TB: { "token": "..." }
    deactivate FEX_API

    TB->>FEX_API: POST /api/v1/anonymous/file<br/>(fetch)
    activate FEX_API
    Note right of TB: Send file metadata (name, size)
    FEX_API-->>TB: { "location": "uploadUrl", "anon_upload_link": "fileKey" }
    deactivate FEX_API

    TB->>FEX_Storage: POST uploadUrl<br/>(fetch)
    activate FEX_Storage
    Note right of TB: Create upload resource
    FEX_Storage-->>TB: 200 OK
    deactivate FEX_Storage

    loop For each file chunk
        TB->>FEX_Storage: PATCH uploadUrl<br/>(fetch)
        activate FEX_Storage
        Note right of TB: Upload file chunk with offset
        FEX_Storage-->>TB: 200 OK
        deactivate FEX_Storage
    end

    Note over TB: Returns file link to Thunderbird
```

