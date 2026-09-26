"""Bound multipart before FastAPI spools files, including chunked uploads."""
from fastapi.responses import JSONResponse
from app.config import settings
class QuickUploadLimit:
    def __init__(self,app): self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']!='http' or scope['method']!='POST' or scope['path']!=settings.API_PREFIX+'/quick-detections':
            return await self.app(scope,receive,send)
        limit=settings.MAX_DETECTION_IMAGE_BYTES+65536
        body=bytearray()
        while True:
            message=await receive()
            if message['type']=='http.disconnect':return
            body.extend(message.get('body',b''))
            if len(body)>limit:
                return await JSONResponse({'success':False,'data':None,'error':{'code':'IMAGE_TOO_LARGE','message':'Upload exceeds the 10 MB image limit'}},status_code=413)(scope,receive,send)
            if not message.get('more_body'):break
        delivered=False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered=True;return {'type':'http.request','body':bytes(body),'more_body':False}
            return await receive()
        await self.app(scope,replay,send)
