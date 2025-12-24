# Use an official lightweight Python image.
# 3.9-slim is a good balance between size and compatibility.
FROM python:3.9-slim

# Set working directory to /app
WORKDIR /app

# Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install python dependencies
# We use --no-cache-dir to keep the image small
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on (Render expects 10000 by default, but we can configure it)
EXPOSE 8000

# Command to run the application
# We use the absolute path to backend.main to be safe
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
