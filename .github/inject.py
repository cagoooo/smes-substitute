import os

def main():
    index_path = 'docs/index.html'
    if not os.path.exists(index_path):
        print(f"Warning: {index_path} not found.")
        return

    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # 替換 API 金鑰佔位符 (若未來有使用 Firebase，可在 index.html 使用 __FIREBASE_API_KEY__ 預留)
    api_key = os.environ.get('VITE_FIREBASE_API_KEY', '')
    if api_key:
        content = content.replace('__FIREBASE_API_KEY__', api_key)
        print("✓ Successfully injected VITE_FIREBASE_API_KEY.")
    else:
        print("i No VITE_FIREBASE_API_KEY env found, skip injection.")

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
