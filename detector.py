import cv2
from ultralytics import YOLO
import numpy as np

class SignDetector:
    def __init__(self, model_path):
        print(f"Loading model from {model_path}...")
        self.model = YOLO(model_path)
        print("Model loaded successfully.")

    def predict(self, frame):
        """
        Runs detection on a single frame and returns the annotated frame.
        """
        results = self.model(frame)
        
        # Plot results on the frame
        annotated_frame = results[0].plot()
        
        return annotated_frame

    def get_stream_frame(self, frame):
         # Run prediction
        annotated_frame = self.predict(frame)
        
        # Encode as JPEG
        ret, buffer = cv2.imencode('.jpg', annotated_frame)
        return buffer.tobytes()

    def process_video_file(self, video_path):
        """
        Generator that yields annotated frames from a video file.
        """
        cap = cv2.VideoCapture(video_path)
        while cap.isOpened():
            success, frame = cap.read()
            if not success:
                break
            
            # Predict
            annotated_frame = self.predict(frame)
            
            # Encode
            ret, buffer = cv2.imencode('.jpg', annotated_frame)
            if not ret:
                continue
                
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
        
        cap.release()
