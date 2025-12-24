# Use an official lightweight Python image.
# Pinning to bookworm ensures stable package names
FROM python:3.9-slim-bookworm

# Set working directory to /app
WORKDIR /app

# Install system dependencies required for OpenCV
# libgl1 is the modern replacement for libgl1-mesa-glx in Debian Bookworm+
RUN apt-get update && apt-get install -y \
    libgl1 \
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
# Now main.py is in the root
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
