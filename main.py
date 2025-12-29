from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
import cv2
import os
import shutil
import uuid
import numpy as np
from detector import SignDetector

app = FastAPI()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.staticfiles import StaticFiles
# Mount the frontend directory to serve static files
# We mount it at the root "/" so index.html works automatically
import os
frontend_path = os.path.join(os.path.dirname(__file__), "frontend")
app.mount("/static", StaticFiles(directory=frontend_path), name="static")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/")
async def read_index():
    return FileResponse(os.path.join(frontend_path, "index.html"))

# Initialize Detector
# Path is relative to the root (where main.py is)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "runs", "detect", "train2", "weights", "best.pt")

# Verify model exists before loading
if not os.path.exists(MODEL_PATH):
    print(f"WARNING: Model not found at {MODEL_PATH}. Check file structure.")

detector = SignDetector(MODEL_PATH)

def generate_frames():
    cap = cv2.VideoCapture(0)  # Use webcam 0
    if not cap.isOpened():
        print("Error: Could not open webcam.")
        return

    while True:
        success, frame = cap.read()
        if not success:
            break
        
        try:
            # Get annotated frame bytes
            frame_bytes = detector.get_stream_frame(frame)
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        except Exception as e:
            print(f"Error processing frame: {e}")
            break
            
    cap.release()

@app.get("/video_feed")
async def video_feed():
    return StreamingResponse(generate_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/detect")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Receive image bytes
            data = await websocket.receive_bytes()
            
            # Decode
            nparr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            # Predict
            if img is not None:
                frame_bytes = detector.get_stream_frame(img)
                await websocket.send_bytes(frame_bytes)
                
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

@app.post("/detect_image")
async def detect_image(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    annotated_img = detector.predict(img)
    ret, buffer = cv2.imencode('.jpg', annotated_img)
    return Response(content=buffer.tobytes(), media_type="image/jpeg")

@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"video_id": filename}

@app.get("/stream_video/{video_id}")
async def stream_video(video_id: str):
    video_path = os.path.join(UPLOAD_DIR, video_id)
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="Video not found")

    def stream_and_cleanup():
        try:
            yield from detector.process_video_file(video_path)
        finally:
            try:
                os.remove(video_path)
            except OSError:
                pass

    return StreamingResponse(stream_and_cleanup(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    # Use PORT environment variable if available (Render/Heroku compatible)
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port,reload=True)
