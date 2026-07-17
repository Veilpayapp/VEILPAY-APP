import json
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.analyze import god_nodes, surprising_connections
from graphify.report import generate
from graphify.export import to_html
from pathlib import Path

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text())
analysis = json.loads(Path('graphify-out/.graphify_analysis.json').read_text())
detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text())

G = build_from_json(extraction)
communities = {int(k): v for k, v in analysis['communities'].items()}
gods = god_nodes(G)
surprises = surprising_connections(G, communities)

report = generate(G, communities, {}, {}, gods, surprises, detect, {'total': 0.0}, 'apps')
Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8')
print('GRAPH_REPORT.md written')

try:
    to_html(G, communities, 'graphify-out/graph.html')
    print('graph.html written')
except ValueError as e:
    print(f'Visualization skipped: {e}')
