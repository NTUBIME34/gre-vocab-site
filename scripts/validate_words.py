#!/usr/bin/env python3
"""
Validate vocab.json and questions.json for data integrity.

Checks:
  - JSON is valid
  - Required fields exist in every entry
  - No duplicate IDs
  - All question optionWordIds reference existing vocab IDs
  - Answer word matches one of the option words

Usage:
  python validate_words.py
"""

import json
import os
import sys


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    vocab_path = os.path.join(data_dir, "vocab.json")
    questions_path = os.path.join(data_dir, "questions.json")

    errors = []

    # --- Validate vocab.json ---
    if not os.path.isfile(vocab_path):
        errors.append(f"Missing file: {vocab_path}")
    else:
        try:
            vocab = load_json(vocab_path)
        except json.JSONDecodeError as e:
            errors.append(f"vocab.json is not valid JSON: {e}")
            vocab = None

        if vocab is not None:
            vocab_ids = set()
            required_fields = {"id", "word", "pos", "english", "chinese"}

            for i, entry in enumerate(vocab):
                for field in required_fields:
                    if field not in entry or not str(entry[field]).strip():
                        errors.append(f"vocab[{i}]: missing or empty field '{field}'")

                vid = entry.get("id", "")
                if vid in vocab_ids:
                    errors.append(f"vocab[{i}]: duplicate id '{vid}'")
                vocab_ids.add(vid)

    # --- Validate questions.json ---
    if not os.path.isfile(questions_path):
        errors.append(f"Missing file: {questions_path}")
    else:
        try:
            questions = load_json(questions_path)
        except json.JSONDecodeError as e:
            errors.append(f"questions.json is not valid JSON: {e}")
            questions = None

        if questions is not None and vocab is not None:
            vocab_map = {v["id"]: v for v in vocab}
            question_ids = set()

            for i, q in enumerate(questions):
                qid = q.get("id", "")
                if qid in question_ids:
                    errors.append(f"questions[{i}]: duplicate id '{qid}'")
                question_ids.add(qid)

                for field in ("id", "wordId", "question", "answer", "optionWordIds"):
                    if field not in q:
                        errors.append(f"questions[{i}]: missing field '{field}'")

                word_id = q.get("wordId", "")
                if word_id and word_id not in vocab_map:
                    errors.append(f"questions[{i}]: wordId '{word_id}' not found in vocab")

                option_ids = q.get("optionWordIds", [])
                if not option_ids:
                    errors.append(f"questions[{i}]: optionWordIds is empty")

                for oid in option_ids:
                    if oid not in vocab_map:
                        errors.append(f"questions[{i}]: optionWordId '{oid}' not found in vocab")

                # Check answer matches one of the option words
                answer = q.get("answer", "")
                option_words = [vocab_map[oid]["word"] for oid in option_ids if oid in vocab_map]
                if answer and answer not in option_words:
                    errors.append(f"questions[{i}]: answer '{answer}' not in options {option_words}")

    # --- Report ---
    if errors:
        print(f"Found {len(errors)} error(s):\n")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    else:
        print("All checks passed!")
        if vocab is not None:
            print(f"  Vocab entries: {len(vocab)}")
        if questions is not None:
            print(f"  Questions: {len(questions)}")
        sys.exit(0)


if __name__ == "__main__":
    main()
