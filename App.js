import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

const API_BASE_URL = 'http://localhost:3001/api';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [files, setFiles] = useState([]);
  const [existingExcel, setExistingExcel] = useState(null);
  const [existingData, setExistingData] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [sessionStats, setSessionStats] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showApiKeyHelp, setShowApiKeyHelp] = useState(false);

  // Load session stats on mount
  useEffect(() => {
    fetchSessionStats();
    // Load saved API key
    const savedApiKey = localStorage.getItem('apiKey');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);

  const fetchSessionStats = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/session-stats`);
      const data = await response.json();
      setSessionStats(data);
    } catch (error) {
      console.error('Error fetching session stats:', error);
    }
  };

  const handleApiKeyChange = (e) => {
    const key = e.target.value;
    setApiKey(key);
    localStorage.setItem('apiKey', key);
  };

  const handleFileUpload = (e) => {
    const uploadedFiles = Array.from(e.target.files);
    const pdfFiles = uploadedFiles.filter(file => file.type === 'application/pdf');
    setFiles(prev => [...prev, ...pdfFiles]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    const pdfFiles = droppedFiles.filter(file => file.type === 'application/pdf');
    setFiles(prev => [...prev, ...pdfFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleExcelUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const formData = new FormData();
      formData.append('excel', file);

      try {
        const response = await fetch(`${API_BASE_URL}/load-excel`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          setExistingExcel(file);
          setExistingData(data.data);
        } else {
          const error = await response.json();
          alert(`Error loading Excel file: ${error.error}`);
        }
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    }
  };

  const processResumes = async () => {
    if (!apiKey.trim()) {
      alert('Please enter your API key');
      return;
    }

    if (files.length === 0) {
      alert('Please upload at least one PDF file');
      return;
    }

    setProcessing(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('apiKey', apiKey);
    
    files.forEach(file => {
      formData.append('resumes', file);
    });

    try {
      const response = await fetch(`${API_BASE_URL}/upload-resumes`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const data = await response.json();
        setResults(data);
        setFiles([]); // Clear files after processing
        await fetchSessionStats();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  const exportToExcel = async (includeExisting = false) => {
    if (!results || results.successful.length === 0) {
      alert('No data to export');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/export-excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: results.successful,
          includeExisting,
          existingData
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resume_database_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const error = await response.json();
        alert(`Export error: ${error.error}`);
      }
    } catch (error) {
      alert(`Export error: ${error.message}`);
    }
  };

  const clearSession = async () => {
    if (window.confirm('Are you sure you want to clear all session data?')) {
      try {
        await fetch(`${API_BASE_URL}/clear-session`, {
          method: 'DELETE'
        });
        setResults(null);
        setFiles([]);
        setExistingExcel(null);
        setExistingData(null);
        await fetchSessionStats();
      } catch (error) {
        alert(`Error clearing session: ${error.message}`);
      }
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🤖 AI Resume Parser</h1>
        <p>Extract structured data from PDF resumes using AI</p>
      </header>

      <main className="app-main">
        {/* API Key Section */}
        <section className="section">
          <h2>API Configuration</h2>
          <div className="api-key-container">
            <div className="input-group">
              <label htmlFor="apiKey">API Key:</label>
              <input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="Enter your OpenRouter or Gemini API key"
                className="api-key-input"
              />
              <button
                type="button"
                onClick={() => setShowApiKeyHelp(!showApiKeyHelp)}
                className="help-button"
              >
                ?
              </button>
            </div>
            {showApiKeyHelp && (
              <div className="help-text">
                <p><strong>Supported APIs:</strong></p>
                <ul>
                  <li><strong>OpenRouter:</strong> Get your API key from <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">openrouter.ai</a> (starts with sk-or-v1-)</li>
                  <li><strong>Google Gemini:</strong> Get your API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a></li>
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* File Upload Section */}
        <section className="section">
          <h2>Upload Resume Files</h2>
          <div
            className={`file-upload-area ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-content">
              <div className="upload-icon">📄</div>
              <p>Drag & drop PDF files here or click to browse</p>
              <input
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileUpload}
                className="file-input"
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="file-list">
              <h3>Selected Files ({files.length})</h3>
              {files.map((file, index) => (
                <div key={index} className="file-item">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatFileSize(file.size)}</span>
                  <button
                    onClick={() => removeFile(index)}
                    className="remove-file-btn"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Existing Excel Section */}
        <section className="section">
          <h2>Existing Database (Optional)</h2>
          <div className="excel-upload">
            <label htmlFor="excel-upload">
              Load existing Excel database to merge with new data:
            </label>
            <input
              id="excel-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              className="excel-input"
            />
            {existingExcel && (
              <div className="excel-loaded">
                <p>✅ Loaded: {existingExcel.name} ({existingData?.length || 0} records)</p>
              </div>
            )}
          </div>
        </section>

        {/* Process Button */}
        <section className="section">
          <button
            onClick={processResumes}
            disabled={processing || files.length === 0 || !apiKey.trim()}
            className={`process-btn ${processing ? 'processing' : ''}`}
          >
            {processing ? (
              <>
                <span className="spinner"></span>
                Processing {files.length} file{files.length !== 1 ? 's' : ''}...
              </>
            ) : (
              `Process ${files.length} Resume${files.length !== 1 ? 's' : ''}`
            )}
          </button>
        </section>

        {/* Results Section */}
        {results && (
          <section className="section results-section">
            <h2>Processing Results</h2>
            
            <div className="results-summary">
              <div className="stat-card success">
                <h3>✅ Successful</h3>
                <p className="stat-number">{results.successful.length}</p>
              </div>
              <div className="stat-card failed">
                <h3>❌ Failed</h3>
                <p className="stat-number">{results.failed.length}</p>
              </div>
              <div className="stat-card already-processed">
                <h3>🔄 Already Processed</h3>
                <p className="stat-number">{results.alreadyProcessed.length}</p>
              </div>
            </div>

            {results.successful.length > 0 && (
              <div className="export-section">
                <h3>Export Options</h3>
                <div className="export-buttons">
                  <button
                    onClick={() => exportToExcel(false)}
                    className="export-btn"
                  >
                    📊 Export New Data Only
                  </button>
                  {existingData && (
                    <button
                      onClick={() => exportToExcel(true)}
                      className="export-btn"
                    >
                      📊 Export Merged Data
                    </button>
                  )}
                </div>
              </div>
            )}

            {results.successful.length > 0 && (
              <div className="data-preview">
                <h3>Data Preview</h3>
                <div className="preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Skills</th>
                        <th>Experience</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.successful.slice(0, 5).map((resume, index) => (
                        <tr key={index}>
                          <td>{resume.name || 'N/A'}</td>
                          <td>{resume.email || 'N/A'}</td>
                          <td>{resume.phone || 'N/A'}</td>
                          <td>
                            {Array.isArray(resume.skills) 
                              ? resume.skills.slice(0, 3).join(', ') + (resume.skills.length > 3 ? '...' : '')
                              : resume.skills || 'N/A'
                            }
                          </td>
                          <td>{resume.experience_years || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {results.successful.length > 5 && (
                    <p className="preview-note">
                      Showing first 5 of {results.successful.length} records
                    </p>
                  )}
                </div>
              </div>
            )}

            {results.failed.length > 0 && (
              <div className="failed-files">
                <h3>Failed Files</h3>
                <div className="failed-list">
                  {results.failed.map((failure, index) => (
                    <div key={index} className="failed-item">
                      <span className="failed-filename">{failure.filename}</span>
                      <span className="failed-error">{failure.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Session Stats */}
        {sessionStats && (
          <section className="section">
            <h2>Session Statistics</h2>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Files Processed:</span>
                <span className="stat-value">{sessionStats.totalProcessedFiles}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Total Resumes in Database:</span>
                <span className="stat-value">{sessionStats.totalResumes}</span>
              </div>
            </div>
            <button onClick={clearSession} className="clear-session-btn">
              🗑️ Clear Session Data
            </button>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>© 2024 AI Resume Parser - Built with React & Electron</p>
      </footer>
    </div>
  );
}

export default App;