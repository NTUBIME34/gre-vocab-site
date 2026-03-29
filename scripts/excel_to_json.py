#!/usr/bin/env python3
"""
Convert an Excel file (.xlsx) to vocab.json and questions.json.

Expected Excel columns:
  id | word | pos | english | chinese | synonyms | antonyms | source | tags |
  question | answer | option1 | option2 | option3 | option4 | difficulty

Usage:
  python excel_to_json.py input.xlsx

Output:
  data/vocab.json
  data/questions.json
"""

import json
import sys
import os

try:
    import openpyxl
except ImportError:
    print("Error: openpyxl is required. Install it with: pip install openpyxl")
    sys.exit(1)


def split_list(value):
    """Split a comma-separated string into a list, or return empty list."""
    if not value:
        return []
    return [s.strip() for s in str(value).split(",") if s.strip()]


def main():
    if len(sys.argv) < 2:
        print("Usage: python excel_to_json.py <input.xlsx>")
        sys.exit(1)

    filepath = sys.argv[1]
    if not os.path.isfile(filepath):
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if len(rows) < 2:
        print("Error: Excel file must have a header row and at least one data row.")
        sys.exit(1)

    header = [str(h).strip().lower() if h else "" for h in rows[0]]

    # Validate required columns
    required = {"id", "word", "pos", "english", "chinese", "question", "answer"}
    missing = required - set(header)
    if missing:
        print(f"Error: Missing required columns: {missing}")
        sys.exit(1)

    vocab_dict = {}  # id -> vocab object (deduplicated)
    questions = []
    word_to_id = {}  # word -> id mapping

    for row_num, row in enumerate(rows[1:], start=2):
        data = dict(zip(header, row))

        word_id = str(data.get("id", "")).strip()
        word = str(data.get("word", "")).strip()

        if not word_id or not word:
            print(f"Warning: Skipping row {row_num} — missing id or word")
            continue

        # Build vocab entry (deduplicated by id)
        if word_id not in vocab_dict:
            vocab_dict[word_id] = {
                "id": word_id,
                "word": word,
                "pos": str(data.get("pos", "")).strip(),
                "english": str(data.get("english", "")).strip(),
                "chinese": str(data.get("chinese", "")).strip(),
                "synonyms": split_list(data.get("synonyms")),
                "antonyms": split_list(data.get("antonyms")),
                "source": str(data.get("source", "")).strip(),
                "tags": split_list(data.get("tags")),
            }
        word_to_id[word] = word_id

        # Build question entry
        question_text = str(data.get("question", "")).strip()
        answer = str(data.get("answer", "")).strip()

        if not question_text or not answer:
            continue

        option_words = []
        for i in range(1, 5):
            opt = str(data.get(f"option{i}", "")).strip()
            if opt:
                option_words.append(opt)

        # We'll resolve option words to IDs after processing all rows
        q_id = f"q{len(questions) + 1:03d}"
        questions.append({
            "id": q_id,
            "wordId": word_id,
            "question": question_text,
            "answer": answer,
            "_optionWords": option_words,
            "difficulty": str(data.get("difficulty", "easy")).strip(),
        })

    # Resolve option words to IDs
    for q in questions:
        option_ids = []
        for opt_word in q.pop("_optionWords"):
            if opt_word in word_to_id:
                option_ids.append(word_to_id[opt_word])
            else:
                print(f"Warning: Option word '{opt_word}' in question '{q['id']}' not found in vocab. Skipping.")
        q["optionWordIds"] = option_ids

    # Write output
    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(output_dir, exist_ok=True)

    vocab_path = os.path.join(output_dir, "vocab.json")
    questions_path = os.path.join(output_dir, "questions.json")

    vocab_list = list(vocab_dict.values())

    with open(vocab_path, "w", encoding="utf-8") as f:
        json.dump(vocab_list, f, ensure_ascii=False, indent=2)

    with open(questions_path, "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    print(f"Done! Exported {len(vocab_list)} words and {len(questions)} questions.")
    print(f"  -> {vocab_path}")
    print(f"  -> {questions_path}")


if __name__ == "__main__":
    main()
