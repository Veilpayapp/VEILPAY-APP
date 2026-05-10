import json
from pathlib import Path

from graphify.analyze import god_nodes, surprising_connections
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.export import to_html
from graphify.report import generate
from networkx.readwrite import json_graph

root = Path('graphify-out')
consumer_detect = json.loads((root / '.graphify_consumer_detect.json').read_text(encoding='utf-8'))
backend_detect = json.loads((root / '.graphify_backend_detect.json').read_text(encoding='utf-8'))

merged_detect = {
    'total_files': consumer_detect.get('total_files', 0) + backend_detect.get('total_files', 0),
    'total_words': consumer_detect.get('total_words', 0) + backend_detect.get('total_words', 0),
    'files': {},
}

for source in (consumer_detect, backend_detect):
    for file_type, file_list in source.get('files', {}).items():
        merged_detect['files'].setdefault(file_type, [])
        merged_detect['files'][file_type].extend(file_list)

parts = [
    json.loads((root / '.graphify_ast.json').read_text(encoding='utf-8')),
    json.loads((root / '.graphify_cached.json').read_text(encoding='utf-8')) if (root / '.graphify_cached.json').exists() else {'nodes': [], 'edges': [], 'hyperedges': []},
    json.loads((root / '.graphify_chunk_1.json').read_text(encoding='utf-8')),
    json.loads((root / '.graphify_chunk_2.json').read_text(encoding='utf-8')),
]

nodes = []
edges = []
hyperedges = []
seen_nodes = set()
seen_edges = set()
seen_hyperedges = set()

for part in parts:
    for node in part.get('nodes', []):
        node_id = node.get('id')
        if node_id and node_id not in seen_nodes:
            seen_nodes.add(node_id)
            nodes.append(node)
    for edge in part.get('edges', []):
        key = (edge.get('source'), edge.get('target'), edge.get('relation'))
        if key not in seen_edges:
            seen_edges.add(key)
            edges.append(edge)
    for hyperedge in part.get('hyperedges', []):
        key = hyperedge.get('id') or json.dumps(hyperedge, sort_keys=True)
        if key not in seen_hyperedges:
            seen_hyperedges.add(key)
            hyperedges.append(hyperedge)

merged = {'nodes': nodes, 'edges': edges, 'hyperedges': hyperedges, 'input_tokens': 0, 'output_tokens': 0}
(root / '.graphify_extract.json').write_text(json.dumps(merged, indent=2), encoding='utf-8')

G = build_from_json(merged)
communities = cluster(G)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)
token_cost = {'input_tokens': 0, 'output_tokens': 0}

(root / '.graphify_analysis.json').write_text(
    json.dumps(
        {
            'communities': {str(k): v for k, v in communities.items()},
            'cohesion': {},
            'god_nodes': gods,
            'surprises': surprises,
        },
        indent=2,
    ),
    encoding='utf-8',
)
(root / 'graph.json').write_text(json.dumps(json_graph.node_link_data(G), indent=2), encoding='utf-8')
(root / 'GRAPH_REPORT.md').write_text(generate(G, communities, {}, {}, gods, surprises, merged_detect, token_cost, str(root)), encoding='utf-8')

print(f'Merged: {len(nodes)} nodes, {len(edges)} edges, {len(hyperedges)} hyperedges')
print(f'Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities')
print(f'God nodes: {[g.get("label") for g in gods[:5]]}')
print(f'Surprises: {len(surprises)}')

try:
    to_html(G, communities, 'graphify-out/graph.html')
    print('graph.html written')
except Exception as exc:
    print(f'Visualization skipped: {exc}')
