# Story Group Review

Local Next.js application for reviewing AI-generated groups of stories or publications and keeping human judgments in versioned JSON files.

## Run locally

Requires Node.js 18.18 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`. The server binds to loopback. Uploaded inputs and saved annotations remain on this computer. Model API calls are made only when a user explicitly requests a translation.

## Translate publication text

Use **Перевести на русский** on a publication card to ask `gpt-6-luna` for a Russian translation of its title and text. The original content is preserved; the translation is displayed separately and is not saved into the annotation session. By default the key is read server-side from the repository-level `.secrets/openai-key`; `OPENAI_API_KEY_FILE` can select a protected host path such as `/etc/ploma/openai-key`. `OPENAI_BASE_URL` can point to an OpenAI-compatible API endpoint. `OPENAI_PROXY_URL` sends only the Luna request through an HTTP CONNECT proxy; `REQUIRE_OPENAI_PROXY=true` disables direct fallback when the proxy is unavailable. The API key is never sent to the browser.

## Production deployment

`next.config.ts` builds a standalone server bundle. The Nginx, systemd, network-namespace, and CONNECT-proxy templates for `ploma.kognitiv.ru` are in `deploy/`. Keep the Next server bound to `127.0.0.1`; set `APP_PUBLIC_ORIGIN=https://ploma.kognitiv.ru` so same-origin browser API requests are accepted behind Nginx. For the included isolated egress layout, set `OPENAI_PROXY_URL=http://10.203.0.2:18888` and `REQUIRE_OPENAI_PROXY=true`; only the translation request uses this proxy.

The deployed setup places the AmneziaWG tunnel and CONNECT proxy in a separate network namespace. Nginx, the site, and ordinary host traffic keep the normal route; only the Luna translation request uses the proxy, and its VPN egress is fail-closed. The current exit uses the supplied Amnezia Premium AWG profile. `OPENAI_API_KEY_FILE` points to `/etc/ploma/openai-key`; provision that secret on the host outside Git.

The production Nginx HTTPS vhost protects the complete site, including API routes, with HTTP Basic Auth. Its bcrypt password file is `/etc/nginx/ploma.htpasswd` (`root:www-data`, mode `0640`) and must be provisioned on the host, not committed. Plain HTTP only redirects to HTTPS; the Let's Encrypt HTTP-01 challenge path remains available for certificate renewal.

## Project export catalog

The start page separates projects into **Doubles** and **Quality**, discovered under `exports/doubles/<project-id>/` and `exports/quality/<project-id>/`. Each project contains a `manifest.json` and the data file named by `sourceFile`. Open a project to review its results or start the matching annotation workflow. Manual CSV/JSON duplicate import remains available at `/review`.

Project exports are kept separate from `data/`, which contains human sessions and remains ignored by Git. Project folders under `exports/` are regular project files.

The built-in doubles export `exports/doubles/seish-october-2.3.10-raw-story-classification/` contains 200 pairs assigned to the same story by prompt 2.3.10 and 200 pairs assigned to different stories. It was generated from the run database using a fixed seed and contains only materialized raw records. See its manifest for source counts and exclusions. Regenerate to a different output directory with:

```bash
python scripts/export_seish_october_review_pairs.py \
  --database data_seish_october_ds20261112_p2_3_10_raw_classify \
  --output web_app/exports/doubles/<new-project-id> \
  --pairs-per-class 200 --seed 23102026
```

The exporter opens PostgreSQL in read-only mode and does not call the model or change the source database.

The built-in Quality export `exports/quality/seish-october-2.3.10-raw-quality-50/` is a seeded uniform sample of 50 out of 1,098 raw-classification stories, with every one of their 111 linked publications. The sample uses seed `20261119`. Each publication is marked **belongs to this story**, **does not belong**, or **uncertain**. The quality percentage is the confirmed share among determinate human labels; it measures precision of existing assignments and does not measure omitted publications/recall. The source run is partial; its status, excluded rows and sampling scope are in the manifest. Regenerate with `python scripts/export_seish_october_quality_stories.py --stories 50 --seed 20261119 --output web_app/exports/quality/<new-project-id>`; the source DB is read-only.

The additional Quality export `exports/quality/seish-october-2.3.10-raw-quality-200-multipub/` contains a seeded uniform sample of 200 stories selected from the 316 stories with at least two assigned publications. All publications linked to each selected story are included. It uses seed `20261120`; the manifest records the eligibility filter, source counts and partial run status. The exporter accepts `--min-publications` to set the eligibility threshold and continues to open PostgreSQL read-only.

The additional Quality export `exports/quality/seish-october-2.3.10-raw-quality-100-multipub/` is an independent seeded uniform sample of 100 from the same 316 eligible stories, with all 721 linked publications included. Each story has at least two publications; seed `2026112001` is recorded in its manifest.

## Import formats

The importer recognizes the project's existing report formats:

- `story_duplicate_cases.csv`: one pair per row (`story_id_a`, `story_id_b`, descriptions and pair metadata).
- `story_duplicate_group_members.csv`: one group member per row, grouped by version, dataset, `group_type` and `group_id`.
- `story_duplicate_all_cliques.csv`: groups with member IDs in the `story_ids` field, separated by `||`.

It also accepts a generic group JSON file:

```json
{
  "datasetId": "seish-october-export-2026-11-12",
  "version": "2.3.10",
  "runId": "raw-classification-example",
  "systemName": "gpt-6-luna",
  "groups": [
    {
      "groupId": "cluster-001",
      "entityType": "story",
      "members": [
        { "id": "story-a", "title": "Story A", "text": "Description A", "category": "Healthcare" },
        { "id": "story-b", "title": "Story B", "text": "Description B", "category": "Healthcare" },
        { "id": "story-c", "title": "Story C", "text": "Description C", "category": "Healthcare" }
      ]
    }
  ]
}
```

Set `entityType` to `publication` for publication groups. A generic CSV can contain one member per row with `group_id`, `item_id` (or `story_id` / `publication_id`), and optional `entity_type`, `text`, `description`, `title`, `version`, `dataset_id`, and `run_id` columns. Pair CSVs can also provide `ai_label` (`same` or `different`) and raw-publication IDs as `raw_id_a` / `raw_id_b`; these predictions are retained in sessions for comparison with human judgments.

## Reviewing and persistence

The tester name is required when starting a session. In a multi-member group, the group checkbox marks every internal pair as “same story”; if the group is mixed, each unordered pair can be marked “same”, “different” or “uncertain” separately. Source files are never edited.

Sessions autosave to:

```text
data/<dataset-id>/<AI-version>/<run-id>/<session-id>.json
```

Quality sessions save after each label/note update and immediately when switching to another story, flushing any pending autosave first. The active story is stored and restored when resuming a session. Saves are serialized so a slower earlier request cannot overwrite newer progress.

If an import contains more than one AI version, the app asks which version to review and creates a separate session in that version's folder. The `data/` directory is ignored by Git. Sessions include the required tester name, source file names, version, original items, type-specific judgments, notes and timestamps. Existing JSON session files can be uploaded later to resume work; the UI also has a download/export action.

## Metrics and interpretation

Imported group membership is treated as a proposed-positive link for review; this does not make heuristic similarity groups gold labels. Doubles projects with explicit `ai_label` values (`same` or `different`) report a confusion matrix, precision, recall, accuracy and pairwise F1 against human labels on the same reviewed pairs. Quality projects collect a separate membership judgment for each publication assigned to a story. Their confirmed share excludes uncertain and unreviewed assignments and does not measure missing publications. Sampled metrics describe that sample, not the full population.

## Development checks

```bash
npm test
npm run typecheck
npm run build
```

Tests use synthetic records for annotation and metrics; catalog tests also verify the bundled 2.3.10 exports.
