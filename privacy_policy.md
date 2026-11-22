# Privacy Policy

**Network Overrides API (DevTools)** extension ("the Extension") is designed to help developers intercept and modify network responses during debugging and development.

## Data Collection

The Extension does **not** collect, transmit, or share any user data with external servers. All data processed by the Extension remains local to the user's device:

- **Override rules**: Stored locally using Chrome's `chrome.storage.local` API
- **Local files**: A file you pick with "Use a local file…" is read in the browser and saved inside its rule; it is never uploaded
- **Injected code**: Scripts and stylesheets of inject rules are added only to the pages their rules match, on your device
- **Captured network requests**: Kept in memory only for the duration of the debugging session
- **No analytics or tracking**: No third-party analytics or tracking code is included

## Permission Usage

The Extension requires the following permissions:

- `debugger`: Used to intercept network requests via the Chrome DevTools Protocol for development/debugging purposes only
- `storage`: Used to persist override rules and user preferences locally
- `<all_urls>` host permission: Required to enable the debugger to attach to any tab being tested

These permissions are used **only** for the declared debugging functionality. The Extension does not use these permissions to access, monitor, or collect user browsing data beyond the immediate debugging session.

## Contact

If you have questions about this privacy policy, please contact the developer through the Chrome Web Store listing.
