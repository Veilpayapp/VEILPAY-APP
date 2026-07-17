import json
from pathlib import Path

all_nodes, all_edges, all_hyperedges = [], [], []

ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text())
all_nodes.extend(ast.get('nodes', []))
all_edges.extend(ast.get('edges', []))

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text())
non_code_files = detect.get('files', {}).get('document', []) + detect.get('files', {}).get('image', [])

for f in non_code_files:
    if not f.strip(): continue
    name = Path(f).name
    ftype = 'image' if name.lower().endswith(('.png', '.webp', '.svg', '.jpg', '.jpeg')) else 'document'
    all_nodes.append({"id": f, "label": name, "file_type": ftype, "source_file": f})

merged = {'nodes': all_nodes, 'edges': all_edges, 'hyperedges': all_hyperedges, 'input_tokens': 0, 'output_tokens': 0}
Path('graphify-out/.graphify_extract.json').write_text(json.dumps(merged, indent=2))
print(f'Merged: {len(all_nodes)} nodes, {len(all_edges)} edges')
