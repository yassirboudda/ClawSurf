import os

directories = [
    '/root/chromium-build/src/chrome/browser',
    '/root/chromium-build/src/chrome/app',
    '/root/chromium-build/src/chrome/common',
    '/root/chromium-build/src/chrome/renderer'
]

for d in directories:
    for root, dirs, files in os.walk(d):
        for f in files:
            if f.endswith('.cc') or f.endswith('.h') or f.endswith('.grd') or f.endswith('.grdp'):
                path = os.path.join(root, f)
                try:
                    with open(path, 'r', encoding='utf-8') as file:
                        content = file.read()
                    
                    if '"Chromium"' in content:
                        new_content = content.replace('"Chromium"', '"AMI Browser"')
                        with open(path, 'w', encoding='utf-8') as out:
                            out.write(new_content)
                except Exception as e:
                    pass

print("String replacement done.")
