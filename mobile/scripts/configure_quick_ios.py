"""Add camera/photo permission strings to an existing iOS project; never regenerate it."""
from pathlib import Path
import plistlib
root=Path(__file__).resolve().parents[1]
path=root/'ios/HenSense/Info.plist'
if not path.is_file():
    raise SystemExit('No existing iOS project. Use npx expo prebuild --platform ios (without --clean).')
with path.open('rb') as f:data=plistlib.load(f)
data['NSCameraUsageDescription']='Allow HenSense to take a photo for Quick Detection.'
data['NSPhotoLibraryUsageDescription']='Allow HenSense to select a photo for Quick Detection.'
with path.open('wb') as f:plistlib.dump(data,f,sort_keys=False)
print('Camera/photo usage descriptions configured. Rebuild the development client.')
