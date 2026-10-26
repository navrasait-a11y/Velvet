# Velvet Phase 2 — Final Backend Handoff

## A. Executive Summary

The backend already had profile CRUD, phonebook contact matching, one-to-one chat list and message retrieval, per-chat favorite flags, block/unblock routes, and scheduled reminder delivery. Earlier Phase 2 work added private-chat password recovery and push-notification preferences. The previous round added emoji-only About status, visibility and expiry fields, and reminder title/type/emoji/date filtering.

This final round audited the existing implementation, preserved those changes, made the empty About status an explicit default for newly created profiles, verified the changes with the available tests, and documented the actual integration contracts. There is no established general-search contract, and live Firebase performance profiling is not possible in this environment; those limitations are recorded below rather than filled with speculative behavior.

No Flutter code, production data, external services, or deployment configuration were changed. Firebase-backed behavior was tested with local mocks only.

## B. Complete Change Log

“Earlier change” means implemented in the prior worktree changes retained in this repository. “Final-round audit” means inspected and verified without changing implementation.

| Feature | Exact files | Status and implementation | Limitations |
|---|---|---|---|
| Private-chat password recovery | `src/routes/privateChat.routes.js`; `src/controller/privateChat.controller.js`; `src/services/privateChat.service.js`; `src/validations/privateChat.validation.js`; `src/routes/private-chat-password-recovery.test.js` | Earlier change. Added authenticated `POST /api/privateChat/password/recover`. It checks the account document’s stored phone, verifies an OTP through the existing OTP service, bcrypt-hashes the replacement password, and uses the existing private-chat limiter. | OTP sessions are in-memory in the existing OTP service; distributed/multi-instance production OTP behavior was not exercised. |
| Push-notification preferences | `src/routes/user.routes.js`; `src/controller/user.controller.js`; `src/services/user.service.js`; `src/services/notification.service.js`; `src/validations/user.validation.js`; `src/routes/user-notification-preferences.test.js` | Earlier change. New accounts default `pushNotificationsEnabled` to `true`; legacy accounts without the field are treated as enabled. Single-recipient and group token lookup suppress push for users explicitly set to `false`. | FCM delivery was mocked; no real Firebase credentials or delivery were available. This setting controls FCM push, not message persistence. |
| About/status | `src/utils/aboutStatus.js`; `src/controller/user.controller.js`; `src/validations/user.validation.js`; `src/routes/user-about-status.test.js` | Earlier change, audited and tested; final round made empty status an explicit creation default. `bio` remains freeform. Emoji-only `aboutStatus`, four visibility values, contact exclusions, and absolute expiry are stored on the existing profile. Public-profile reads enforce visibility; owner-only profile read exposes the settings. Excluded IDs are checked against the owner’s saved contacts. | Contact relationship meaning follows the existing `User_Contacts/{profileOwner}/contacts/{contactId}` structure. |
| Reminder fields and filters | `src/services/reminder.service.js`; `src/controller/reminder.controller.js`; `src/validations/reminder.validation.js`; `src/routes/reminder.routes.test.js` | Earlier change, audited and tested; final round ensured missing title/emoji/type defaults are normalized on legacy reads and edits. Added optional title, emoji, type and inclusive date-range filtering. Missing titles default to the reminder message for old request bodies and legacy records. Existing ownership and scheduler logic remain. | Scheduler sends the reminder `message` and optional attachment to its target; it does not convert `title`, `emoji`, or `type` into message content. |
| Chat list | `src/routes/chat.routes.js`; `src/controller/chat.controller.js`; `src/services/chat.service.js` | Final-round audit only. The backend reads the caller’s entire RTDB `userChats` node, filters locally, batch-fetches participant profile/user documents, then sorts and returns the existing response shape. No code change was justified without Firebase measurements or a compatible pagination contract. | No production-equivalent latency, reads, or response-size benchmark. See Section F. |
| Search | `src/routes/user.routes.js`; `src/controller/user.controller.js`; `src/routes/chat.routes.js`; `src/services/chat.service.js`; existing `src/services/contact.service.js` | Final-round audit only. `/api/user/check-contact` is a phonebook synchronization/matching API, not general search. No chat-name or message search route/index exists, and the intended UI search scope is not established. | No search API added; a product/API decision is needed before implementation. |
| Unblock | `src/routes/block.routes.js`; `src/controller/block.controller.js`; `src/services/block.service.js`; `src/validations/block.validation.js` | Final-round audit only. `DELETE /api/block/revert/:userId` authenticates the caller and removes only the target entry from the caller’s block-list document. Missing/repeated relationship returns 404; success returns 200. No reproducible backend defect was established. | Requires the failing Flutter request and subsequent request/log to diagnose the reported 404. |
| Favorite state | `src/routes/chatOption.routes.js`; `src/controller/chatOption.controller.js`; `src/services/chatOption.service.js`; `src/services/chat.service.js`; `src/controller/user.controller.js` | Final-round audit only. Favorite is a per-user, per-chat `userChats/{userId}/{roomId}/isFavorite` boolean. Updates set the requested value and the chat list returns it. A public profile has no room context. | Profile/chat UI synchronization requires Flutter state/navigation/request evidence. |
| Invitation/download URL | Repository source, `.env.example`, config and route search | Final-round audit only. No `/download` route, Velvet download domain, or backend invitation URL generator was found. | Requires Flutter source and/or production DNS, TLS, hosting, and redirect access. |

## C. Complete API Reference

All paths below are mounted under `/api`. Protected routes require a Bearer JWT:

```http
Authorization: Bearer <JWT>
```

For JSON request bodies, send `Content-Type: application/json`. Multipart profile requests use `multipart/form-data`; allow the HTTP client to set the multipart boundary. GET requests do not require a content type. The server returns JSON envelopes with `success`; validation failures use HTTP 400 and generally `{ "success": false, "message": "..." }`. The profile upload pipeline accepts `profileImage` and `bannerImage` fields.

### C1. OTP needed for account verification

#### `POST /api/auth/send-otp`

- Authentication: none.
- Body: `{ "phone": "<account phone number>" }`.
- Success: HTTP 200, `{ "success": true, "sessionId": "<opaque OTP session ID>" }`.
- Errors: validation errors 400; OTP provider/configuration failure 400; throttling 429.
- Existing OTP behavior: 4-digit code, 10-minute expiry, maximum four verification attempts, 15-second resend cooldown. Production also has app-level rate limiting.
- The OTP service stores sessions in process memory; do not assume sessions survive a process restart or work across separate application instances.

#### `POST /api/auth/verify-otp`

- Authentication: none.
- Body: `{ "phone": "...", "sessionId": "...", "otp": "1234" }`.
- This is the existing login/registration verification route; recovery should use the session ID from `send-otp` and submit the OTP to the recovery endpoint below. Do not call this route to change the private-chat password; it verifies login and returns a JWT.

### C2. Private-chat password

All routes are authenticated. Password-operation routes use the private-chat rate limiter (production maximum 10 attempts per user per 15 minutes).

#### `GET /api/privateChat/status`

- Success: HTTP 200, `{ "success": true, "enabled": true }` (false when not configured).

#### `POST /api/privateChat/setup`

- Body: `{ "password": "<8–64 characters>" }`.
- Success: HTTP 200, `{ "success": true, "message": "Private chat password created successfully" }`.
- Errors: 400 validation/input; 409 if a password already exists; 500 unexpected service failure.

#### `POST /api/privateChat/verify`

- Body: `{ "password": "..." }`.
- Success: HTTP 200, `{ "success": true, "verified": true, "message": "Password verified successfully" }`.
- Errors: 400 for validation; 401 for invalid password or disabled private chat; 429 for rate limit.

#### `PATCH /api/privateChat/password`

- Purpose: change a known password; it is not the recovery route.
- Body: `{ "oldPassword": "...", "newPassword": "<8–64 characters>" }`.
- Success: HTTP 200, `{ "success": true, "message": "Password changed successfully" }`.
- Errors: 400 for missing/invalid inputs or identical old/new values; 401 for incorrect current password or disabled private chat; 429 for rate limit.

#### `POST /api/privateChat/password/recover`

- Purpose: recover a forgotten private-chat password. The user must still be authenticated to Velvet and must prove possession of the phone attached to that authenticated account with OTP.
- Body:

```json
{
  "sessionId": "<session from /api/auth/send-otp>",
  "otp": "1234",
  "newPassword": "new-private-password"
}
```

- Success: HTTP 200, `{ "success": true, "message": "Password reset successfully" }`.
- Errors: 400 malformed fields/password; 401 invalid/expired/reused OTP or failed account verification; 404 if private chat is not enabled; 429 if throttled; 500 unexpected database/hash failure.
- OTP is bound to the stored account phone by `verifyOtp`; successful verification consumes the session. The auth JWT is still required. Production server startup refuses `TEST_OTP`, but development/test bypasses may be enabled via environment variables and must never be used in production.

#### `DELETE /api/privateChat/password`

- Body: `{ "password": "..." }`.
- Success: HTTP 200, `{ "success": true, "message": "Private chat disabled successfully" }`.
- Errors: 400 validation; 401 incorrect password or disabled private chat; 429 throttled.

### C3. Push-notification preference

#### `GET /api/user/notification-preferences`

- Authentication: required; only the JWT user’s preference is returned.
- Success:

```json
{
  "success": true,
  "data": { "pushNotificationsEnabled": true }
}
```

- Missing account: 404. Unexpected database failure: 500.
- Legacy user documents with no preference are read as enabled.

#### `PATCH /api/user/notification-preferences`

- Body: `{ "pushNotificationsEnabled": false }`; the value must be an actual JSON boolean, not a string.
- Success: HTTP 200 with the new boolean in `data`.
- Errors: 400 invalid input; 404 missing user; 500 database failure.
- The setting only suppresses FCM push delivery. It does not delete, suppress, or prevent saving messages.

### C4. Profile, About, and Status

#### `POST /api/user/create`

- Authentication: required.
- Body: JSON or multipart form fields:
  - Required `name` (2–50 characters).
  - Optional `bio` (freeform string, maximum 200 characters).
  - Optional `aboutStatus` (maximum 100 characters; emoji-only; empty string clears).
  - Optional `aboutVisibility`: `everyone`, `contacts`, `contacts_except`, or `nobody`.
  - Optional `aboutExcludedContacts`: up to 100 user IDs; JSON array or JSON-encoded array for multipart.
  - Optional `aboutExpiresAt`: timezone-qualified ISO 8601 datetime.
  - Optional `profileImage` and `bannerImage` files.
- About defaults on profile creation: empty status, `everyone`, empty exclusions, no expiry.
- Success: HTTP 201, `{ "success": true, "message": "Profile created successfully", "data": <profile> }`.
- Errors: 400 invalid profile/status/expiry/exclusions; 400 if profile already exists; 500 unexpected storage/database failure.
- Excluded users must already be present in the profile owner’s saved contacts.

#### `PATCH /api/user/update`

- Authentication: required; changes apply to the authenticated user only.
- Body: same optional profile/About fields as above, except `name` is optional. Only supplied fields are updated. Setting `aboutExpiresAt` to `null` or empty clears expiry. Empty `aboutStatus` clears the status.
- Success: HTTP 200, `{ "success": true, "message": "Profile updated successfully", "data": <merged profile> }`.
- Errors: 400 invalid values; 404 profile not found; 500 unexpected failure.
- Existing freeform `bio` remains unchanged in purpose and validation.

#### `GET /api/user/me`

- Authentication: required.
- Success includes the authenticated profile fields (`name`, images, `bio`, phone, timestamps) plus owner-only About fields `aboutStatus`, `aboutVisibility`, `aboutExcludedContacts`, and `aboutExpiresAt`. Expired status is returned as an empty string, and the saved expiry remains available for the owner.
- Errors: 404 profile not found; 500 unexpected failure.

#### `GET /api/user/profile/:userId`

- Authentication: required.
- Success returns public profile fields (`userId`, `name`, profile image, `bio`) and conditionally `aboutStatus` only if active and visible to the authenticated viewer.
- Visibility:
  - `everyone`: all viewers.
  - `contacts`: users in the profile owner’s `User_Contacts/{owner}/contacts` list.
  - `contacts_except`: those contacts except listed exclusions.
  - `nobody`: no other user.
- When hidden, `aboutStatus` is omitted from the data object. Visibility/exclusion settings are not returned publicly. Expired status is omitted/empty, not active.
- Errors: 404 profile missing; 500 unexpected failure.

### C5. Contact matching (not general search)

#### `POST /api/user/check-contact`

- Authentication: required.
- Body: `{ "contacts": [{ "phone": "...", "name": "..." }] }`, up to 1,000 entries.
- Matches normalized phone numbers against registered users, excludes the caller, returns registered users and unregistered phonebook entries, and syncs contact relationships.
- Success fields include `totalContacts`, `velvetUsers`, `inviteUsers`, `registeredUsers`, and `unregisteredContacts`.
- This endpoint does **not** search chat names or message contents, and does not provide query pagination. Do not use it as an invented general-search contract.

### C6. Chat list and favorites

#### `GET /api/chat/list`

- Authentication: required.
- Optional query filters: `favorite=true`, `archived=true`, `private=true`. The implementation applies private first, then archived, then favorite, then the default inbox.
- Success: `{ "success": true, "count": <number>, "data": [<chat entries>] }`.
- Each entry retains chat metadata and includes normalized `isFavorite`, `isArchived`, `isPinned`, `isPrivate`, and a `profile` object. There is no paging parameter or cursor.

#### `PATCH /api/options/favorite/:roomId`

- Authentication: required; the chat flag is stored under the JWT user ID, not a client-supplied owner ID.
- Body: `{ "isFavorite": true }` (boolean; the existing validator also accepts coercible boolean strings).
- Success: HTTP 200, `{ "success": true, "message": "Favorite status updated successfully" }`.
- Errors: 400 invalid room/boolean; 404 chat entry absent for this user; 500 unexpected failure.
- Set `true` to favorite and `false` to unfavorite; this is idempotent. Fetch `/api/chat/list` afterward to obtain current state. A profile endpoint cannot supply a single favorite value without the relevant room ID.

### C7. Blocked contacts

#### `POST /api/block/make`

- Authentication: required.
- Body: `{ "userId": "<target user ID>" }`.
- Success: HTTP 200 success message.
- Errors: 400 invalid/self target; 404 target user absent; 409 already blocked; 500 unexpected failure.

#### `DELETE /api/block/revert/:userId`

- Authentication: required. `userId` is the target user ID; the authenticated user owns the block list.
- Success: HTTP 200, `{ "success": true, "message": "User unblocked successfully" }`.
- Errors: 400 invalid/self target; 404 relationship absent/already removed; 500 unexpected failure.
- If Flutter reports 404, capture the actual method, full URL, path value, authorization presence (never log the token), response body, and any immediately following request.

#### `GET /api/block/list`

- Authentication: required.
- Success: `{ "success": true, "count": <number>, "data": [{ "userId": "...", "blockedAt": <timestamp> }] }`.

### C8. Reminders

All reminder routes require a Bearer JWT. JSON bodies may also be sent as multipart form fields when uploading the existing `file` attachment. The target must be a group or existing private chat as validated by the existing service.

#### `POST /api/reminders`

- Required: `message` (1–2,000 chars), `targetType` (`private_chat` or `group`), `targetId`, timezone-qualified future `scheduledAt`; `receiverId` required for `private_chat`.
- Optional: `title` (max 200), `emoji` (max 32 Unicode characters and emoji-only), `type` (1–40 chars), `mentions` (array or JSON-encoded array), `file`.
- If omitted, title defaults to the message; emoji/type default to null.
- Success: HTTP 201, `{ "success": true, "message": "Reminder scheduled", "data": <reminder> }`.
- Errors: 400 invalid fields/date/file/target; 403 target membership/access; 404 target missing; 429 limiter; 500 unexpected failure.

Example JSON body:

```json
{
  "title": "Call family",
  "message": "Call family after work",
  "targetType": "private_chat",
  "targetId": "other-user-id",
  "receiverId": "other-user-id",
  "scheduledAt": "2026-10-27T15:00:00Z",
  "emoji": "📞",
  "type": "personal",
  "mentions": []
}
```

#### `GET /api/reminders`

- Optional query: `startAt` and/or `endAt`, timezone-qualified ISO 8601. Filtering is inclusive by `scheduledAt`; both filters may be supplied. `startAt > endAt` returns 400.
- Only reminders created by the authenticated user are returned. Existing hidden statuses (`sent`, `cancelled`, `completed`) remain omitted.
- Success: `{ "success": true, "count": <number>, "data": [<reminders sorted newest scheduled time first>] }`.
- Each result includes `title`, `emoji`, and `type`. Older stored records receive title=`message`, emoji=null, type=null in reads.

#### `GET /api/reminders/:id`

- Returns one owned reminder. Success: `{ "success": true, "data": <reminder> }`.
- Errors: 400 malformed ID; 403 not creator; 404 absent.

#### `PUT /api/reminders/:id`

- Updates supplied reminder fields (`title`, `message`, target fields, `scheduledAt`, `emoji`, `type`, `mentions`, and attachment); only creator can edit a still-pending future reminder.
- Success: HTTP 200, `{ "success": true, "message": "Reminder updated", "data": <reminder> }`.
- Errors: 400 invalid fields/date; 403 not creator/not target member; 404 missing target/reminder; 409 reminder is not editable; 429 limiter; 500 unexpected failure.

#### `DELETE /api/reminders/:id`

- Cancels a future pending reminder; it does not hard-delete the record.
- Success: HTTP 200, `{ "success": true, "message": "Reminder cancelled" }`.
- Errors: 400 malformed ID; 403 not creator; 404 missing reminder; 409 not pending/not future; 429 limiter.

### C9. Search

No general search endpoint exists. No route or data/index contract specifies contact-name, chat-name, or message search. No new search path, request/response shape, or pagination cursor has been added. Product must decide scope, matching semantics, privacy behavior, and pagination before implementation.

## D. Flutter Integration Instructions

1. **Authentication:** Send `Authorization: Bearer <JWT>` to every protected endpoint. Recovery still requires this JWT in addition to OTP proof.
2. **Profile About status:** Keep `bio` as freeform profile text. Store/display the emoji-only value separately as `aboutStatus`. Use the enum values exactly as documented. Send `aboutExcludedContacts` as a JSON array for JSON requests; serialize it as JSON when using multipart. Only select exclusions from the owner’s known saved contacts. Treat an omitted `aboutStatus` on a public profile as hidden, not as an empty public status. Treat empty status as cleared and an expired status as inactive.
3. **Push preference:** Read `/api/user/notification-preferences` when loading settings; send an actual boolean in the PATCH body and update UI from response `data`. Disabling this setting disables FCM push only; messages continue to persist and appear in chat.
4. **Private-chat password:** Use `PATCH /api/privateChat/password` when the user knows the old password. For recovery, request an OTP through `/api/auth/send-otp` using the account phone, then submit its `sessionId`, OTP, and new password to authenticated `POST /api/privateChat/password/recover`. Never send the OTP or password to analytics/logging. Display the route’s generic failed/expired OTP response and allow an OTP resend only subject to rate limits.
5. **Reminders:** Continue using existing create/list/get/update/delete routes. Send `title`, `emoji`, and `type` separately from `message`; old clients may omit these. Use `startAt`/`endAt` to filter calendar ranges with timezone offsets. Both endpoints are inclusive. Do not depend on scheduler delivery to include title/emoji/type in the delivered chat text; scheduler delivers the reminder message and attachment.
6. **Chat list:** Existing clients can continue reading the same `/api/chat/list` response. It has no pagination. Do not assume an unseen continuation cursor.
7. **Favorites:** Send the desired boolean to `/api/options/favorite/:roomId`; then refresh or update the corresponding chat’s `isFavorite` from `/api/chat/list`. Do not infer favorite state from a profile response without a chat room.
8. **Contacts:** `/api/user/check-contact` is phonebook sync/matching; it is not general search. Do not call it for message or chat-name search.
9. **Unblock:** Use `DELETE /api/block/revert/:userId`, where the path ID is the target user ID. On a 404, record the method/path/body/status and next client request for backend diagnosis. Do not repeatedly retry a genuine “not blocked” result as success.
10. **Invitation:** No backend download link is available. Flutter/deployment owners must locate the app’s invitation string and verify the destination with hosting/DNS owners.

## E. Data Model and Migration Notes

| Record | Field | Format/default |
|---|---|---|
| Firestore `users/{userId}` | `pushNotificationsEnabled` | Boolean. New accounts true; absent legacy field is interpreted as true. No backfill required. |
| Firestore `Users_Profile/{userId}` | `aboutStatus` | Emoji-only string; defaults to empty string on new profile creation. Existing profile records are handled as empty if absent. |
| Firestore `Users_Profile/{userId}` | `aboutVisibility` | `everyone`, `contacts`, `contacts_except`, or `nobody`; new profiles default to `everyone`; older records without the field behave as `everyone`. |
| Firestore `Users_Profile/{userId}` | `aboutExcludedContacts` | Array of owner contact user IDs, default `[]`; IDs validated against `User_Contacts/{owner}/contacts/{contactId}`. |
| Firestore `Users_Profile/{userId}` | `aboutExpiresAt` | Unix epoch milliseconds or null. Input/output date setter uses timezone-qualified ISO 8601. Expiry is absolute; backend runtime timezone is irrelevant after parsing. |
| RTDB `reminders/{id}` | `title` | String. New legacy-compatible fallback is the message if omitted; old records without it are returned with title set to `message`. |
| RTDB `reminders/{id}` | `emoji`, `type` | Optional emoji-only string/null and optional string/null. Older records are returned with null values. |
| RTDB `reminders/{id}` | `scheduledAt` | Existing Unix epoch milliseconds. Date-range query values are timezone-qualified ISO strings converted to milliseconds. |

No database migration/backfill is required. Defaults are applied on new writes and to read responses; legacy records remain usable by old and new clients.

## F. Performance Findings

### Current chat-list flow

`GET /api/chat/list` → authenticated route → controller reads filter query params → `getChatList`:

1. Reads the complete `userChats/{userId}` RTDB node, ordered by `updatedAt`.
2. Filters favorite/archive/private mode in application memory.
3. Collects distinct `otherUser` IDs among retained entries.
4. In chunks of at most 30 participant IDs, fetches `Users_Profile` documents and `users` documents with Firestore `getAll` calls. These profile and account documents are not duplicates; both are used (profile name/image and account phone).
5. Builds the existing chat response and sorts pinned chats first, then descending by `updatedAt`.

Code-derived read shape: one RTDB full-node read plus, for `N` unique retained participants, up to `2 × ceil(N / 30)` Firestore batch-get operations. This is a code-derived operation count, not measured Firebase billed reads or elapsed time.

### Measurements and changes

- No `FIREBASE_SERVICE_ACCOUNT`, service account path, individual Firebase credentials, or `FIREBASE_DATABASE_URL` is configured in the environment; no production data was available.
- No endpoint latency, read latency, database operation telemetry, large-list run, or response-byte measurement was collected.
- No chat-list optimization was made. Changing the default list to pagination or limiting results would alter existing client behavior, and page ordering with pinned entries needs a compatible cursor contract.
- There is no demonstrated repeated read of the same participant within a call: participant IDs are deduplicated and batched. No profile cache was added because it could become stale and authorization/favorite state must remain current.

Production owners should profile representative users with small and large chat histories, record RTDB/Firestore operations and response bytes, then define whether backward-compatible opt-in pagination is required. If pagination is approved, its cursor must account for the current pinned-first sort and existing filters.

## G. Unresolved Issues and Flutter Tasks

| Issue | Backend status | Flutter action required | Evidence / required information |
|---|---|---|---|
| General search | No API; requirements do not establish search scope. | Decide whether the search box searches registered contacts, chat/group names, message bodies, or multiple tabs/scopes; define ranking and paging UX. | Endpoint `/api/user/check-contact` only syncs phonebook contact data. No message search index or route exists. |
| Chat-list 5–10 second load | No live measurement; current code reads complete user chat node and batches profile/account reads. | Provide request timing, chat count, response bytes, client timing breakdown, and test account/environment. | Firebase credentials and production dataset unavailable; code-derived reads are in Section F. |
| Unblock 404 | No reproducible backend defect established. Endpoint behaves as 200 removal, 404 absent relationship. | Capture actual HTTP method/full URL/target ID (redact token), response payload/status, and any next route called. | Existing route is `DELETE /api/block/revert/:userId`. |
| Favorite absent on profile | Favorite belongs to a user/chat relationship and is returned in chat-list entries. Profile request has no room context. | Check that the correct room ID is used, the PATCH succeeds, and profile navigation refreshes or reads the chat state. | `PATCH /api/options/favorite/:roomId`; public profile response has no `roomId` or favorite field. |
| Invitation/download link | No backend route or link-generation/config reference found. | Find any hardcoded invite URL and verify the intended mobile store/deep-link destination. | Repository search found no `/download` or `velvet.app` backend reference. Hosting/DNS/TLS require infrastructure owner. |
| Production OTP recovery / FCM / reminders | Mock tests pass; external systems untested. | Coordinate production staging integration tests with backend/infrastructure; never use real user notifications for tests. | Requires configured Firebase, OTP provider, and safe test accounts/project. |

## H. Testing and Verification

### Commands executed

- `node --test` — final suite: **23 tests passed, 0 failed**.
- Focused Node runs for About/status and reminder routes, and for recovery/notification preference regressions.
- `node --check` on changed JavaScript files.
- `git diff --check`.

### Coverage and limitations

- `src/routes/user-about-status.test.js`: emoji validation, freeform bio, creation defaults, all visibility modes, contact exclusions, expiry, malformed/expired input.
- `src/routes/reminder.routes.test.js`: existing CRUD/scheduler coverage plus optional fields, legacy title fallback, date bounds, reversed ranges, invalid emoji, and scheduler delivery.
- `src/routes/private-chat-password-recovery.test.js`: authenticated recovery, validation, wrong current password, OTP failure/success and hashed replacement. This test uses test-mode OTP bypass; OTP expiry, attempt limit, reuse, and phone binding are separately covered by the existing OTP service tests.
- `src/routes/user-notification-preferences.test.js`: default, update/enable/disable persistence, authorization, new-account default, single and group push filtering. Firebase messaging is mocked.
- `src/services/otp.service.test.js`: OTP send/verify behavior, expiry, four-attempt invalidation, phone binding, cooldown and rate limit. HTTP provider is mocked.
- Reminder route integration uses a mocked RTDB and bucket. It verifies scheduler message/attachment flow locally, not production scheduling or FCM.
- No real Firebase, OTP-provider, production performance, or Flutter integration test was run.
- The repository has no configured lint/build/test script; the available test suite is run directly with Node.

Warnings about mocked Firebase module circular dependencies and expected validation/error paths appear in test output; the suite passes. They do not establish production service health.

## I. Final Flutter Developer Handoff

1. Integrate notification preferences using authenticated GET/PATCH; treat absent legacy preference as enabled.
2. Keep freeform profile `bio` separate from About status; implement the four visibility choices and send exact enum values. Display status only when `aboutStatus` is present/nonempty.
3. Use `/api/auth/send-otp` followed by authenticated `/api/privateChat/password/recover` for forgotten private-chat passwords; retain `PATCH /api/privateChat/password` for normal changes.
4. Integrate reminder title/emoji/type as optional fields and use inclusive `startAt`/`endAt` query bounds for calendar views; continue using message as scheduled chat delivery content.
5. Refresh the room’s chat-list state after favorite mutations. Do not expect profile endpoint to report room-specific favorite state.
6. Use `DELETE /api/block/revert/:userId` with the target user ID; provide exact request/response logs if the reported error persists.
7. Do not implement general search against `/check-contact`. Obtain a product decision on search scope before requesting a new backend contract.
8. Locate invitation/download URL ownership in Flutter and coordinate domain/hosting verification with infrastructure.
9. Provide representative production-like chat-list traces and coordinate safe staging tests for Firebase-backed notifications, OTP and scheduling.
