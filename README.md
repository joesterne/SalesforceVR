# SalesforceVR

VR-first Salesforce org schema visualizer that renders object relationships as an interactive 3D cloud.

## Features

- Builds a floating schema cloud from Salesforce-style JSON metadata.
- Uses WebXR for immersive VR navigation.
- Trigger-grab individual object nodes and reposition them in space.
- Grip and move controller to rotate the entire cloud.
- Room-aware cloud scaling that adapts to VR boundary sizes when available.
- Desktop mode supports mouse/touch exploration via orbit controls.
- Salesforce OAuth 2.0 Authorization Code + PKCE login flow.
- Direct org schema fetch from Salesforce REST API (`/sobjects` + per-object `describe`).

## Run locally

Because browsers block ES module imports from `file://`, run with a local static server:

```bash
python3 -m http.server 5173
```

Then open: `http://localhost:5173`.

## Salesforce setup

1. Create a Salesforce Connected App.
2. Enable OAuth and include callback URL: `http://localhost:5173/` (or your deployed app URL).
3. OAuth scopes should include at least:
   - `api`
   - `refresh_token` (or `offline_access` depending on org settings)
4. Copy the Consumer Key into **Connected App Client ID**.

## Input format

Paste JSON into the in-app text area:

```json
{
  "objects": [
    {
      "name": "Account",
      "fields": [
        { "name": "OwnerId", "type": "Lookup", "referenceTo": "User" }
      ]
    }
  ]
}
```

Every field with `referenceTo` matching another object creates a relationship line in the cloud.
