# Generate Flow

## Preconditions

- Repo path is confirmed
- Startup mode has been chosen
- OpenMAIC is healthy at the selected `url`
- Provider keys are configured
 
## Requirement-Only Generation

If the user has already clearly asked to generate the classroom and the preconditions are satisfied, submit the generation job immediately. Do not ask for a second confirmation just before calling `/api/generate-classroom`.

Submit the job with:

```text
POST {url}/api/generate-classroom
```

Request body:

```json
{
  "requirement": "Create an introductory classroom on quantum mechanics for high school students"
}
```

Only send supported content fields:

- `requirement`
- optional `pdfContent`
- optional `language`

Do not rely on request-time model or provider override parameters.

Treat the `POST` response as job submission only. Expect fields such as:

```json
{
  "success": true,
  "jobId": "abc123",
  "status": "queued",
  "step": "queued",
  "pollUrl": "http://localhost:3000/api/generate-classroom/abc123",
  "pollIntervalMs": 5000
}
```

## PDF-Based Generation

1. Resolve the absolute path to the PDF.
2. Confirm before reading the file.
3. Parse the PDF first:

```text
POST {url}/api/parse-pdf
```

4. Then send `requirement` plus `pdfContent` to:

```text
POST {url}/api/generate-classroom
```

## Polling Loop

After the job is submitted:

1. Save `jobId`, `pollUrl`, and `pollIntervalMs`.
2. Do not submit another generation job while this one is still `queued` or `running`.
3. Poll:

```text
GET {pollUrl}
```

4. Use a steady polling cadence of about 5 seconds between polls.
5. Treat `queued` and `running` as in-progress states.
6. Stop only when `status` becomes `succeeded` or `failed`.

### Reliability Rules

- Never restart the job just because a poll request fails once.
- If a poll request returns a transient network error or `5xx`, wait 5 seconds and retry the same `pollUrl`.
- If the job is still running after many polls, tell the user it is still in progress and continue polling instead of resubmitting.
- Within a single agent turn, cap active polling to about 10 minutes or 120 polls. If the job is still not finished, tell the user it is still running and include the `jobId` and `pollUrl` so a later turn can continue checking without resubmitting.
- Report progress to the user only when `status`, `step`, or visible progress meaningfully changes. Do not spam every poll result.
- Do not try to recover from auth, provider, model, or base URL errors by changing request parameters. Tell the user to fix OpenMAIC server-side config and retry only after they confirm.
- On `failed`, surface the server error and include the `jobId`.
- On `succeeded`, use `result.classroomId` and `result.url` from the final poll response.

## What To Return

Return the generated classroom ID plus a directly clickable classroom URL.

Output the URL as a raw absolute URL on its own line.

Do not wrap the URL in:

- bold markers such as `**...**`
- markdown links such as `[title](url)`
- code formatting such as `` `...` ``
- angle brackets such as `<...>`
- markdown tables

Use a compact format like:

```text
Classroom ID: Uyh82Y32ZK
Classroom URL:
http://localhost:3001/classroom/Uyh82Y32ZK
```

If the job fails, return the job ID plus the server error.

If generation fails, surface the server error directly instead of paraphrasing it away.

If the error suggests a provider or model configuration problem, explicitly tell the user to update `.env.local` or `server-providers.yml` instead of attempting a runtime override.

## Confirmation Requirements

- Ask before reading a local PDF.
- Do not ask for a second confirmation before the generation request if the user has already clearly asked you to generate the classroom.
