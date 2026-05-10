import os
import re

def migrate_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content

    # 1. Update Imports
    # Fix NeoPop imports
    content = re.sub(r'import\s+\{([^}]*)\}\s+from\s+[\'"](?:\.\./)+components/NeoPop[\'"];?', 
                     r'import { HybridCard } from "../components/HybridCard";\nimport { HybridButton } from "../components/HybridButton";', content)
    
    # Fix Sovereign imports
    content = re.sub(r'import\s+\{([^}]*)\}\s+from\s+[\'"](?:\.\./)+components/Sovereign[\'"];?', 
                     r'import { HybridCard } from "../components/HybridCard";\nimport { HybridButton } from "../components/HybridButton";', content)

    # Clean up duplicate imports if they happen
    imports_to_dedupe = [
        ('import { HybridCard } from "../components/HybridCard";', ''),
        ('import { HybridButton } from "../components/HybridButton";', '')
    ]
    # We will do a distinct pass for deduplication if needed, but doing it simple here

    # 2. Update JSX Tags
    content = content.replace('<NeoPopCard', '<HybridCard')
    content = content.replace('</NeoPopCard>', '</HybridCard>')
    
    content = content.replace('<SovereignCard', '<HybridCard')
    content = content.replace('</SovereignCard>', '</HybridCard>')

    content = content.replace('<NeoPopButton', '<HybridButton')
    content = content.replace('</NeoPopButton>', '</HybridButton>')

    content = content.replace('<SovereignButton', '<HybridButton')
    content = content.replace('</SovereignButton>', '</HybridButton>')

    # 3. Prop Mapping (Best effort regex)
    # Map `color="..."` to `backgroundColor="..."` on HybridCard
    content = re.sub(r'<HybridCard([^>]*?)\bcolor=([\'"][^\'"]+[\'"]|\{[^}]+\})', r'<HybridCard\1backgroundColor=\2', content)

    if content != original:
        # Deduplicate the imports manually for safety
        lines = content.split('\n')
        seen_imports = set()
        final_lines = []
        for line in lines:
            if 'import { HybridCard }' in line or 'import { HybridButton }' in line:
                if line in seen_imports:
                    continue
                seen_imports.add(line)
            final_lines.append(line)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('\n'.join(final_lines))
        print(f"Migrated: {filepath}")

def walk_dir(directory):
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.tsx') or file.endswith('.ts'):
                migrate_file(os.path.join(root, file))

if __name__ == "__main__":
    app_dir = os.path.join('apps', 'consumer-app', 'src')
    walk_dir(os.path.join(app_dir, 'screens'))
    walk_dir(os.path.join(app_dir, 'components'))
