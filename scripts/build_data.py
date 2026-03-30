#!/usr/bin/env python3
"""
Build vocab.json and questions.json from raw extracted words.

Generates two question types:
  - cloze: fill-in-the-blank using the word's example sentence
  - definition: choose the word that matches the English definition (fallback)

Usage:
  python build_data.py                                # default: all words
  python build_data.py --limit 500                    # limit to 500 words
  python build_data.py --limit 300 --pos adj.,v.      # only adj & verb
"""
import argparse
import json
import os
import re
import random
from collections import Counter
import opencc

# Simplified → Traditional Chinese converter
_s2t = opencc.OpenCC('s2t')
def to_tc(text):
    """Convert Simplified Chinese text to Traditional Chinese."""
    if not text:
        return text
    return _s2t.convert(text)


def make_cloze(word, example_en):
    """Replace the target word in the example sentence with ______."""
    stem = word.rstrip('e')
    pattern = re.compile(
        r'\b(' + re.escape(word) + r'[a-z]*'
        + r'|' + re.escape(stem) + r'[a-z]*)\b',
        re.IGNORECASE
    )
    result = pattern.sub('______', example_en, count=1)
    if result == example_en:
        return None
    return result


def main():
    parser = argparse.ArgumentParser(description="Build site data from raw words")
    parser.add_argument("--raw", default=None,
                        help="Path to raw_extracted_words.json")
    parser.add_argument("--limit", default="all",
                        help="Number of words to select, or 'all' (default: all)")
    parser.add_argument("--pos", default="",
                        help="Comma-separated POS to include. Empty = all")
    parser.add_argument("--min-eng", type=int, default=10,
                        help="Minimum English definition length (default: 10)")
    parser.add_argument("--min-chi", type=int, default=2,
                        help="Minimum Chinese definition length (default: 2)")
    parser.add_argument("--seed", type=int, default=42,
                        help="Random seed for reproducibility")
    args = parser.parse_args()

    random.seed(args.seed)

    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
    if args.raw is None:
        args.raw = os.path.join(data_dir, 'raw_extracted_words.json')

    with open(args.raw, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    print(f"Raw words loaded: {len(raw)}")

    for w in raw:
        w['pos'] = w['pos'].replace('..', '.')

    good = [w for w in raw
            if len(w['english']) >= args.min_eng
            and len(w.get('chinese', '')) >= args.min_chi]
    print(f"After quality filter: {len(good)}")

    if args.pos:
        allowed_pos = set(p.strip() for p in args.pos.split(','))
        good = [w for w in good if w['pos'] in allowed_pos]
        print(f"After POS filter ({args.pos}): {len(good)}")

    if args.limit.lower() == 'all':
        limit = len(good)
    else:
        limit = int(args.limit)

    # POS-balanced selection
    pos_groups = {}
    for w in good:
        p = w['pos']
        if p not in pos_groups:
            pos_groups[p] = []
        pos_groups[p].append(w)

    for words in pos_groups.values():
        random.shuffle(words)

    total_good = len(good)
    selected = []

    if limit >= total_good:
        selected = good[:]
    else:
        for pos, words in pos_groups.items():
            proportion = len(words) / total_good
            count = max(1, round(limit * proportion))
            selected.extend(words[:count])
        random.shuffle(selected)
        selected = selected[:limit]

    random.shuffle(selected)

    # Build vocab.json
    vocab = []
    for i, w in enumerate(selected, 1):
        equivs = [e for e in w.get('equivalents', [])
                  if len(e) >= 3 and e.lower() != w['word'].lower()
                  and e.isalpha() and len(e) <= 20]
        vocab.append({
            "id": f"w{i:04d}",
            "word": w['word'],
            "pos": w['pos'],
            "english": w['english'],
            "chinese": to_tc(w.get('chinese', '')),
            "example_en": w.get('example_en', ''),
            "example_zh": to_tc(w.get('example_zh', '')),
            "synonyms": equivs[:5],
            "antonyms": [],
            "source": "GRE 鎮考3000詞",
            "tags": [w['pos'].rstrip('.')]
        })

    # POS index for distractors
    vocab_pos_groups = {}
    for v in vocab:
        p = v['pos']
        if p not in vocab_pos_groups:
            vocab_pos_groups[p] = []
        vocab_pos_groups[p].append(v['id'])

    # Build questions: cloze first, definition as fallback
    questions = []
    cloze_count = 0
    def_count = 0

    for v in vocab:
        same_pos = [vid for vid in vocab_pos_groups[v['pos']] if vid != v['id']]
        if len(same_pos) < 3:
            same_pos = [vv['id'] for vv in vocab if vv['id'] != v['id']]

        distractors = random.sample(same_pos, min(3, len(same_pos)))
        option_ids = [v['id']] + distractors
        random.shuffle(option_ids)

        question_type = "definition"
        question_text = f"Choose the word that means: {v['english']}"
        hint = ""

        if v['example_en']:
            cloze_text = make_cloze(v['word'], v['example_en'])
            if cloze_text:
                question_type = "cloze"
                question_text = cloze_text
                hint = v.get('example_zh', '')
                cloze_count += 1
            else:
                def_count += 1
        else:
            def_count += 1

        q = {
            "id": f"q{len(questions)+1:04d}",
            "wordId": v['id'],
            "questionType": question_type,
            "question": question_text,
            "answer": v['word'],
            "optionWordIds": option_ids,
            "difficulty": "medium"
        }
        if hint:
            q["hint"] = hint

        questions.append(q)

    # Write files
    vocab_path = os.path.join(data_dir, 'vocab.json')
    questions_path = os.path.join(data_dir, 'questions.json')

    with open(vocab_path, 'w', encoding='utf-8') as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

    with open(questions_path, 'w', encoding='utf-8') as f:
        json.dump(questions, f, ensure_ascii=False, indent=2)

    pos_dist = Counter(v['pos'] for v in vocab)
    print(f"\n=== Build Complete ===")
    print(f"Vocab: {len(vocab)} words")
    print(f"Questions: {len(questions)}")
    print(f"  Cloze (fill-in-blank): {cloze_count}")
    print(f"  Definition (fallback): {def_count}")
    print(f"  Cloze rate: {cloze_count/max(1,len(questions))*100:.1f}%")
    print(f"POS distribution:")
    for p, c in pos_dist.most_common():
        print(f"  {p}: {c}")


if __name__ == "__main__":
    main()