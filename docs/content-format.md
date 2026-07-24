# Content Format

## book.json

Root object is a `Book`:

| Field | Type | Required |
|-------|------|----------|
| id | string | yes |
| title | string | yes |
| version | string | yes |
| language | string | yes |
| pages | Page[] | yes |
| isbn | string | no |
| coverUri | string | no |
| metadata | object | no |

### Page

| Field | Type | Required |
|-------|------|----------|
| id | string | yes |
| bookId | string | yes (= book.id) |
| pageNumber | number | yes |
| width / height | number | yes (page units, e.g. mm) |
| hotspots | Hotspot[] | yes |
| previewUri | string | no |

### Hotspot

| Field | Type | Required |
|-------|------|----------|
| id | string | yes |
| pageId | string | yes |
| bounds | Rect | yes |
| clips | Clip[] (≥1) | yes |
| oid | string | no (preferred match key) |
| polygon | Point[] | no |
| label | string | no |
| tags | string[] | no |

### Clip

| Field | Type | Required |
|-------|------|----------|
| id | string | yes |
| uri | string | yes (relative to `content/audio/`) |
| durationMs | number | no |
| language | string | no |
| transcript | string | no |

## Coordinate space

- Origin: top-left of the printed page.
- Units: same as `page.width` / `page.height` (recommend mm or normalized 0–1000).
- Hit order: last hotspot in array wins (topmost).
