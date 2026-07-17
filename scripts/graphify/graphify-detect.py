import json, sys
from graphify.detect import detect
from pathlib import Path

res1 = detect(Path('apps/consumer-app'))
res2 = detect(Path('apps/backend'))

def merge_detect(r1, r2):
    out = {'total_files': r1.get('total_files', 0) + r2.get('total_files', 0),
           'total_words': r1.get('total_words', 0) + r2.get('total_words', 0),
           'files': {}}
    all_keys = set(r1.get('files', {}).keys()) | set(r2.get('files', {}).keys())
    for k in all_keys:
        out['files'][k] = r1.get('files', {}).get(k, []) + r2.get('files', {}).get(k, [])
    return out

merged = merge_detect(res1, res2)
Path('graphify-out/.graphify_detect.json').write_text(json.dumps(merged, indent=2))
print(f"Corpus: {merged['total_files']} files, ~{merged['total_words']} words")
for ftype, files in merged.get('files', {}).items():
    if files:
        print(f'  {ftype}: {len(files)} files')
