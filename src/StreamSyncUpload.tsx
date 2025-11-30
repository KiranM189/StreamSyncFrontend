import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import "./StreamSyncUpload.css";

export default function StreamSyncUpload() {
  const ffmpegRef = useRef(new FFmpeg());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messageRef = useRef<HTMLParagraphElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const [offsetMs, setOffsetMs] = useState(0);          // ✔ controlled slider
  const [offsetReceived, setOffsetReceived] = useState(false);

  const playTimer = useRef<NodeJS.Timeout | null>(null);

  // ---------------------------------------------------------
  // Load FFmpeg
  // ---------------------------------------------------------
  const load = async () => {
    const baseURL =
      "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
    const ffmpeg = ffmpegRef.current;

    ffmpeg.on("log", ({ message }) => {
      if (messageRef.current) messageRef.current.innerHTML = message;
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript"),
    });
  };

  useEffect(() => {
    load();
  }, []);

  // ---------------------------------------------------------
  // AUTO-CONVERT AVI → MP4 for preview
  // ---------------------------------------------------------
  const autoTranscodeIfNeeded = async (originalFile: File): Promise<File> => {
    const ext = originalFile.name.split(".").pop()?.toLowerCase();

    if (ext !== "avi") return originalFile;

    setMessage("Converting AVI → MP4 for preview...");
    const ffmpeg = ffmpegRef.current;

    await ffmpeg.writeFile("input.avi", await fetchFile(originalFile));

    await ffmpeg.exec([
      "-i", "input.avi",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "output.mp4"
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const safeCopy = data.slice();
    const blob = new Blob([safeCopy.buffer], { type: "video/mp4" });

    const convertedFile = new File([blob], originalFile.name.replace(".avi", ".mp4"), {
      type: "video/mp4",
    });

    setMessage("AVI converted successfully!");

    return convertedFile;
  };

  // ---------------------------------------------------------
  // Validate
  // ---------------------------------------------------------
  const validateFile = (file: File) => {
    const allowedExt = ["mp4", "webm", "mov", "mkv", "avi"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!allowedExt.includes(ext!)) return "Unsupported file!";
    if (file.size > 1024 * 1024 * 1024) return "Max file size is 1GB";
    return "";
  };

  // ---------------------------------------------------------
  // Select File
  // ---------------------------------------------------------
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const err = validateFile(f);
    if (err) {
      setError(err);
      return;
    }
    setError("");

    const processedFile = await autoTranscodeIfNeeded(f);
    setFile(processedFile);

    const url = URL.createObjectURL(processedFile);

    if (videoRef.current) videoRef.current.src = url;
    if (audioRef.current) audioRef.current.src = url;
  };

  const handleInputAndUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFileSelect(e);
    if (e.target.files?.[0]) handleUpload();
  };

  // ---------------------------------------------------------
  // Preview Logic (A/V offset)
  // ---------------------------------------------------------
  const handlePreview = () => {
    if (!file) return;

    if (playTimer.current) clearTimeout(playTimer.current);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    const delay = Number(offsetMs);

    if (delay >= 0) {
      videoRef.current?.play();
      playTimer.current = setTimeout(() => {
        audioRef.current?.play();
      }, delay);
    } else {
      audioRef.current?.play();
      playTimer.current = setTimeout(() => {
        videoRef.current?.play();
      }, -delay);
    }
  };

  const handleStop = () => {
    if (playTimer.current) clearTimeout(playTimer.current);
    videoRef.current?.pause();
    audioRef.current?.pause();
  };

  // ---------------------------------------------------------
  // Upload to server → get offset → APPLY TO SLIDER
  // ---------------------------------------------------------
  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setMessage("Processing...");

    const formData = new FormData();
    formData.append("video", file);

    try {
      const response = await fetch("http://172.236.110.221:5000/api/upload", {
        method: "POST",
        body: formData
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      // Server sends: offset_frames, confidence, offsetMs
      // -----------------------------------------------------
      // ✔ APPLY detected offset to slider
      // -----------------------------------------------------
      if (data.offsetMs !== undefined) {
        setOffsetMs(data.offsetMs);       // 🔥 auto-apply server offset
        setOffsetReceived(true);

        // 🔥 Automatically show accurate preview
        setTimeout(() => handlePreview(), 400);
      }

      alert(
        `Sync Complete!\nFrames: ${data.offset_frames}\nConfidence: ${data.confidence}\nOffset(ms): ${data.offsetMs}`
      );

      setMessage("Offset received. Use preview or save corrected version.");
    } catch (err) {
      console.error(err);
      setError("Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // ---------------------------------------------------------
  // Save Corrected Video
  // ---------------------------------------------------------
  const handleSave = async () => {
    if (!file) return alert("Select a file first");

    const ffmpeg = ffmpegRef.current;
    await ffmpeg.writeFile("input", await fetchFile(file));

    const delaySeconds = Math.abs(offsetMs) / 1000;
    const audioOffset = offsetMs > 0 ? -delaySeconds : delaySeconds;

    await ffmpeg.exec([
      "-i", "input",
      "-itsoffset", audioOffset.toString(),
      "-i", "input",
      "-map", "1:v",
      "-map", "0:a",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-preset", "veryfast",
      "output.mp4",
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const safeCopy = data.slice();
    const blob = new Blob([safeCopy.buffer], { type: "video/mp4" });

    if (videoRef.current) videoRef.current.src = URL.createObjectURL(blob);
  };

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  return (
    <div className="container-1">
      <div className="streamsync-card">

        {/* LEFT PANEL */}
        <div>
          <h1 className="heading">StreamSync — Upload your out-of-sync video</h1>
          <p className="subtext">Upload a video and get automatic AV offset detection.</p>

          <label
            className="upload-box"
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (!f) return;
              const processed = await autoTranscodeIfNeeded(f);
              setFile(processed);

              const url = URL.createObjectURL(processed);
              if (videoRef.current) videoRef.current.src = url;
              if (audioRef.current) audioRef.current.src = url;

              handleUpload();
            }}
          >
            <input type="file" accept="video/*" onChange={handleInputAndUpload} />
            <p className="upload-note">Drag & drop or click to select</p>
            <p className="upload-support">Supported: MP4, WebM, MOV, MKV, AVI</p>
          </label>

          {error && <div className="error-msg">{error}</div>}

          <div className="btn-row">
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="btn-green"
            >
              {uploading ? "Uploading…" : "Upload & Analyze"}
            </button>

            {offsetReceived && (
              <button onClick={handleSave} className="btn-blue">
                Save
              </button>
            )}
          </div>

          {message && <p className="subtext" style={{ color: "#16a34a" }}>{message}</p>}
        </div>

        {/* RIGHT PANEL */}
        <div>
          <div className="preview-box">
            <video ref={videoRef} controls className="video-player" />
            <audio ref={audioRef} style={{ display: "none" }} />

            <p className="file-label">
              File: <strong>{file ? file.name : "No file selected"}</strong>
            </p>
          </div>

          {/* OFFSET SLIDER */}
          <div style={{ marginTop: "12px" }}>
            <label className="subtext" style={{ fontSize: "13px", fontWeight: 600 }}>
              Adjust audio offset (ms)
            </label>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="range"
                min={-2000}
                max={2000}
                step={10}
                value={offsetMs}
                onChange={(e) => setOffsetMs(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <span style={{ fontSize: "13px" }}>{offsetMs} ms</span>
            </div>

            <p className="subtext" style={{ fontSize: "11px", marginTop: "4px" }}>
              Positive = audio delayed. Negative = audio ahead.
            </p>

            <div style={{ marginTop: "10px", display: "flex", gap: "8px" }}>
              <button onClick={handlePreview} className="btn-blue">
                Preview
              </button>
              <button onClick={handleStop} className="btn-green">
                Stop
              </button>
            </div>
          </div>

          <div className="how-box">
            <h3 className="how-title">How it works</h3>
            <ul className="how-list">
              <li>Upload your video</li>
              <li>Server detects sync delay</li>
              <li>Preview the corrected sync instantly</li>
              <li>Save corrected video</li>
            </ul>
          </div>
        </div>

        <p ref={messageRef}></p>
      </div>
    </div>
  );
}
