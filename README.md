# GRE Vocabulary Practice

A pure frontend GRE vocabulary review website built with HTML, CSS, and JavaScript.

## Features

- **Practice Mode** — Random GRE vocabulary questions with instant feedback
- **Smart Review** — Prioritizes due words using mistakes, mastery, and last review time
- **Practice Wrong Words Only** — Focus on words you've gotten wrong
- **New Words Mode** — Practice words that have no local review history yet
- **Word Bank** — Browse all words with search/filter (English, Chinese, POS)
- **Statistics** — See most-missed words, mastery, and recent reviews
- **Session Retry** — Retry the words missed in the current session
- **Progress Backup** — Export, import, or reset local browser progress
- **Keyboard Shortcuts** — Use 1-4 to answer, Enter for next, and H for hints
- **Local Storage** — Practice progress persists across browser sessions
- **Separated Data** — Vocab and questions stored in JSON for easy updates

## Project Structure

```
gre-vocab-site/
├── index.html              # Main page
├── style.css               # Styles
├── app.js                  # Application logic
├── data/
│   ├── vocab.json          # Word definitions (id, word, pos, english, chinese, synonyms, antonyms)
│   └── questions.json      # Questions referencing vocab by ID
├── scripts/
│   ├── excel_to_json.py    # Convert Excel → vocab.json + questions.json
│   └── validate_words.py   # Validate data integrity
└── README.md
```

## Getting Started

This site uses `fetch()` to load JSON data, so you need a local HTTP server (not `file://`).

### Quick start

```bash
# If you have Node.js:
npx serve .

# Or Python:
python3 -m http.server 8000
```

Then open `http://localhost:3000` (serve) or `http://localhost:8000` (Python).

## Updating the Word Bank

### Option 1: Edit JSON directly

Edit `data/vocab.json` and `data/questions.json` following the existing format.

### Option 2: From Excel

1. Create an Excel file with these columns:

   | id | word | pos | english | chinese | synonyms | antonyms | source | tags | question | answer | option1 | option2 | option3 | option4 | difficulty |

2. Run the converter:

   ```bash
   pip install openpyxl
   python scripts/excel_to_json.py your_file.xlsx
   ```

### Option 3: From LLM

Give GPT/Claude this prompt template to generate JSON:

```
Please convert the following GRE words into a JSON array.
Each entry must follow this format exactly:
{
  "id": "w001",
  "word": "",
  "pos": "",
  "english": "",
  "chinese": "",
  "synonyms": [],
  "antonyms": [],
  "source": "",
  "tags": []
}
Do not output any extra text.
```

### Validate data

```bash
python scripts/validate_words.py
```

## Deployment

This is a static site. Deploy to any of:
- **GitHub Pages** — push to repo, enable Pages in settings
- **Netlify** — drag & drop or connect Git repo
- **Cloudflare Pages** — connect Git or direct upload
- **Vercel** — connect Git repo

## GitHub Pages Notes

This project is intentionally static so it can run on GitHub Pages. That means:

- No server-side code, database, scheduled jobs, or private environment variables.
- All JSON data is public once deployed.
- Practice progress is browser-local `localStorage`, not synced between devices.
- Export/import progress is the backup path for moving progress between browsers.
- Large data files are downloaded by the browser, so keep JSON reasonably sized.
- GitHub Pages may take a short time to reflect new pushes after deployment.

Practice progress is stored in the browser's `localStorage` under:

- `wrongCounts`
- `correctCounts`
- `reviewTimes`

Clearing browser data will reset progress unless you export it first.
