import cv2
from ultralytics import YOLO
import numpy as np
import torch

class SignDetector:
    def __init__(self, model_path):
        print(f"Loading model from {model_path}...")
        self.model = YOLO(model_path)
        
        # Check and log device
        if torch.cuda.is_available():
            self.device = 'cuda'
            print(f"🚀 Using GPU: {torch.cuda.get_device_name(0)}")
        elif torch.backends.mps.is_available():
            self.device = 'mps'
            print("🍎 Using Apple Silicon MPS Acceleration")
        else:
            self.device = 'cpu'
            print("⚠️ Using CPU (Performance might be slow on Windows/Intel)")
            
        self.model.to(self.device)
        self.imgsz = 256
        self.conf = 0.25
        self.use_half = self.device == 'cuda'
        self.video_stream_width = 1280
        print("Model loaded successfully.")

    def predict(self, frame):
        """
        Runs detection on a single frame and returns the annotated frame.
        """
        results = self.model.predict(
            frame,
            imgsz=self.imgsz,
            conf=self.conf,
            device=self.device,
            half=self.use_half,
            verbose=False,
        )
        
        # Plot results on the frame
        annotated_frame = results[0].plot()
        
        return annotated_frame

    def get_stream_frame(self, frame):
         # Run prediction
        annotated_frame = self.predict(frame)
        
        # Encode as JPEG
        ret, buffer = cv2.imencode('.jpg', annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
        return buffer.tobytes()

    def get_detections(self, frame):
        results = self.model.predict(
            frame,
            imgsz=self.imgsz,
            conf=self.conf,
            device=self.device,
            half=self.use_half,
            verbose=False,
        )

        detections = []
        boxes = results[0].boxes
        if boxes is None:
            return detections

        names = results[0].names
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0])
            cls = int(box.cls[0])
            detections.append(
                {
                    "box": [x1, y1, x2, y2],
                    "conf": conf,
                    "label": names.get(cls, str(cls)),
                }
            )
        return detections

    def process_video_file(self, video_path):
        """
        Generator that yields annotated frames from a video file.
        """
        cap = cv2.VideoCapture(video_path)
        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                break
            
            # Resize frame for faster processing (video stream size)
            height, width = frame.shape[:2]
            target_width = self.video_stream_width
            if width > target_width:
                scale = target_width / width
                new_height = int(height * scale)
                frame = cv2.resize(frame, (target_width, new_height))

            # Predict
            annotated_frame = self.predict(frame)
            
            # Encode
            ret, buffer = cv2.imencode('.jpg', annotated_frame)
            if not ret:
                continue
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        
        cap.release()
