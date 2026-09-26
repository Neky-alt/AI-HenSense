"""Environment-configured AI startup; preserves api_server model defaults."""
import os
from pathlib import Path
from dotenv import load_dotenv
import uvicorn

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    load_dotenv(root / '.env')
    os.chdir(root)  # Model paths are relative to the AI package, not caller cwd.
    uvicorn.run('api_server:app', host=os.getenv('AI_HOST', '127.0.0.1'),
                port=int(os.getenv('AI_PORT', '8004')), reload=False)
