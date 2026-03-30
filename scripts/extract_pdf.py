#!/usr/bin/env python3
"""
Extract GRE vocabulary from icyo.pdf (镇考3000词).

Scans ALL content pages and extracts:
  word, pos, english, chinese, example_en, example_zh, equivalents

Usage:
  python extract_pdf.py                          # default paths
  python extract_pdf.py --pdf /path/to/icyo.pdf
  python extract_pdf.py --out data/raw.json
"""
import argparse
import os
import re
import json
from collections import Counter
from pypdf import PdfReader
import opencc

# Simplified → Traditional Chinese converter
_s2t = opencc.OpenCC('s2t')
def to_tc(text):
    """Convert Simplified Chinese text to Traditional Chinese."""
    if not text:
        return text
    return _s2t.convert(text)

# Regex to detect start of a new word entry: lowercase word followed by phonetic bracket
WORD_START_RE = re.compile(r"^([a-z][a-zA-Z' -]*?)\s+[\[\(ˈˌ/]")

SKIP_KEYWORDS = ['单词', '页，共', '_®', '张巍', '镇考', '目录',
                  'Page ', 'Contents', 'list1', 'list2', 'list3',
                  'list4', 'list5', 'list6', 'list7', 'list8', 'list9',
                  'List ']

HAS_CHINESE_RE = re.compile(r'[\u4e00-\u9fff]')
CHINESE_BLOCK_RE = re.compile(r'([\u4e00-\u9fff\uff0c\u3001\uff1b\uff08\uff09\u2026\u3002\uff01\uff1f\u201c\u201d\u2018\u2019，。！？""''、；：]+)')


def is_skip_line(line):
    return any(kw in line for kw in SKIP_KEYWORDS)


def extract_words(pdf_path, start_page=4, end_page=None):
    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)
    if end_page is None:
        end_page = total_pages

    # Collect all lines from all pages with page numbers
    all_lines = []
    for i in range(start_page, end_page):
        try:
            text = reader.pages[i].extract_text()
        except Exception:
            continue
        if not text:
            continue
        for line in text.split('\n'):
            stripped = line.strip()
            if stripped and not is_skip_line(stripped):
                all_lines.append((stripped, i + 1))  # (line, 1-indexed page)

    # Pass 1: identify word entry start positions
    entry_starts = []
    for idx, (line, page) in enumerate(all_lines):
        m = WORD_START_RE.match(line)
        if m:
            word = m.group(1).strip().rstrip(' -')
            if len(word) >= 3 and word[0].islower():
                entry_starts.append((idx, word, page))

    # Pass 2: for each entry, collect its block of lines until the next entry
    raw_entries = []
    for ei in range(len(entry_starts)):
        start_idx, word, page = entry_starts[ei]
        end_idx = entry_starts[ei + 1][0] if ei + 1 < len(entry_starts) else len(all_lines)
        block_lines = [all_lines[k][0] for k in range(start_idx, min(end_idx, start_idx + 25))]
        raw_entries.append((word, page, block_lines))

    # Pass 3: parse each entry block
    words = []
    for word, page, block_lines in raw_entries:
        block = " ".join(block_lines)

        # Extract POS
        pos_match = re.search(r'\b(adj|adv|n|v)\.\s', block)
        if not pos_match:
            continue
        pos = pos_match.group(0).strip()

        # Extract English definition
        after_pos = block[pos_match.end():]
        eng_parts = re.split(r'[\u4e00-\u9fff]', after_pos)
        eng = ""
        if eng_parts and len(eng_parts[0].strip()) > 3:
            eng = re.sub(r'\s+', ' ', eng_parts[0]).strip().rstrip(' ,;')
        if not eng:
            continue

        # Extract Chinese definition (first Chinese block after POS)
        chi = ""
        chi_search_area = block[pos_match.start():]
        chi_matches = CHINESE_BLOCK_RE.findall(chi_search_area)
        for cm in chi_matches:
            if len(cm) >= 2:
                chi = cm[:80]
                break

        # --- Extract example sentences ---
        # Strategy: find all lines after definition, look for English sentence
        # (contains the target word or starts uppercase) then Chinese translation
        example_en = ""
        example_zh = ""

        # Find the line index where definition ends (after Chinese def)
        # and example begins. We look for lines that form English sentences.
        def_ended = False
        en_parts = []
        zh_parts = []
        collecting_en = False
        collecting_zh = False

        for li, bline in enumerate(block_lines):
            if li == 0:
                continue  # skip the word header line

            # Check if this line looks like it's part of the definition area
            # (has POS tag, phonetic, or is the Chinese definition)
            if not def_ended:
                # Definition area ends when we see a line that looks like
                # an English sentence (starts with uppercase, longer text)
                # and doesn't have POS markers
                if (re.match(r'^[A-Z][a-zA-Z]', bline)
                    and len(bline) > 15
                    and not re.search(r'\b(adj|adv|n|v)\.\s', bline)
                    and not re.match(r'^[A-Z][a-z]+\s+\[', bline)):
                    def_ended = True
                    collecting_en = True

            if collecting_en:
                if HAS_CHINESE_RE.search(bline):
                    # Switch to Chinese example
                    collecting_en = False
                    collecting_zh = True
                    zh_parts.append(bline)
                else:
                    en_parts.append(bline)
            elif collecting_zh:
                if HAS_CHINESE_RE.search(bline):
                    zh_parts.append(bline)
                else:
                    break  # done with this entry's example

        if en_parts:
            example_en = re.sub(r'\s+', ' ', ' '.join(en_parts)).strip()
            # Clean up: remove trailing punctuation artifacts
            example_en = example_en.rstrip()
        if zh_parts:
            example_zh = ''.join(zh_parts).strip()

        # Extract equivalent words (等价词)
        equivalents = []
        # They appear as standalone words between definition and example,
        # often comma-separated English words
        equiv_area = block[pos_match.end():pos_match.end() + 200]
        # Look for patterns like "hone" or "eclipse" or "mockery" after Chinese def
        if chi:
            chi_pos = equiv_area.find(chi)
            if chi_pos >= 0:
                after_chi = equiv_area[chi_pos + len(chi):]
                # Find English words before the example sentence
                eq_match = re.match(r'\s*([a-zA-Z, -]+)', after_chi)
                if eq_match:
                    raw_eq = eq_match.group(1).strip()
                    for eq_word in re.split(r'[,\s]+', raw_eq):
                        eq_word = eq_word.strip()
                        if len(eq_word) >= 3 and eq_word[0].islower():
                            equivalents.append(eq_word)

        words.append({
            "word": word,
            "pos": pos.replace('..', '.') + ("." if not pos.endswith(".") else ""),
            "english": eng[:200],
            "chinese": to_tc(chi) if chi else "",
            "example_en": example_en[:500],
            "example_zh": to_tc(example_zh[:500]),
            "equivalents": equivalents[:10],
            "page": page
        })

    # Deduplicate
    seen = set()
    unique = []
    for w in words:
        key = w["word"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(w)

    return unique, total_pages


def main():
    parser = argparse.ArgumentParser(description="Extract GRE words from PDF")
    parser.add_argument("--pdf", default="/Users/changchewei/Downloads/icyo.pdf",
                        help="Path to the PDF file")
    parser.add_argument("--out", default=None,
                        help="Output JSON path (default: data/raw_extracted_words.json)")
    parser.add_argument("--start-page", type=int, default=4,
                        help="First page to scan (0-indexed, default: 4)")
    parser.add_argument("--end-page", type=int, default=None,
                        help="Last page to scan (exclusive, default: all)")
    args = parser.parse_args()

    if args.out is None:
        args.out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'data', 'raw_extracted_words.json')

    unique, total_pages = extract_words(args.pdf, args.start_page, args.end_page)

    # Stats
    good = [w for w in unique if len(w['english']) > 10 and len(w['chinese']) >= 2]
    with_example = [w for w in unique if w['example_en']]
    with_equiv = [w for w in unique if w['equivalents']]
    pos_dist = Counter(w['pos'] for w in unique)

    print(f"PDF pages: {total_pages}")
    print(f"Scanned pages: {args.start_page} – {args.end_page or total_pages}")
    print(f"Total unique words: {len(unique)}")
    print(f"High-quality (eng>10 & chi>=2): {len(good)}")
    print(f"With example sentences: {len(with_example)}")
    print(f"With equivalent words: {len(with_equiv)}")
    print(f"POS distribution:")
    for p, c in pos_dist.most_common():
        print(f"  {p}: {c}")

    print(f"\nSample entries:")
    for w in unique[:8]:
        print(f"  {w['word']} ({w['pos']}): {w['english'][:40]}")
        print(f"    中文: {w['chinese']}")
        if w['example_en']:
            print(f"    例句EN: {w['example_en'][:80]}")
        if w['example_zh']:
            print(f"    例句ZH: {w['example_zh'][:60]}")
        if w['equivalents']:
            print(f"    等价词: {', '.join(w['equivalents'])}")

    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)

    print(f"\nSaved {len(unique)} words → {args.out}")


if __name__ == "__main__":
    main()
