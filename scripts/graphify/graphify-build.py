import json
from graphify.build import build_from_json
from graphify.cluster import cluster
from graphify.analyze import god_nodes, surprising_connections
from pathlib import Path
import networkx as nx
from networkx.readwrite import json_graph

extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text())
G = build_from_json(extraction)
communities = cluster(G)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)

graph_data = json_graph.node_link_data(G)
Path('graphify-out/graph.json').write_text(json.dumps(graph_data, indent=2))
Path('graphify-out/.graphify_analysis.json').write_text(json.dumps({
    'communities': {str(k): v for k, v in communities.items()},
    'cohesion': {},
    'god_nodes': gods,
    'surprises': surprises,
}, indent=2))
print(f'Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities')
print(f'God nodes: {[g["label"] for g in gods[:5]]}')
