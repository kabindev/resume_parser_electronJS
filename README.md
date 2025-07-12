# AI Resume Parser

A desktop application that uses AI to extract structured data from PDF resumes and export to Excel format.

## Features

- **AI-Powered Parsing**: Uses OpenRouter or Google Gemini API to extract resume information
- **Drag & Drop Interface**: Easy file uploading with drag and drop support
- **Excel Export**: Export parsed data to Excel format with merge capabilities
- **Duplicate Detection**: Prevents processing the same file multiple times
- **Session Management**: Track processing statistics and manage session data
- **Cross-Platform**: Works on Windows, macOS, and Linux

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- API key from either:
  - [OpenRouter](https://openrouter.ai) (recommended)
  - [Google Gemini](https://aistudio.google.com/app/apikey)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/ai-resume-parser.git
cd ai-resume-parser
```

2. Install dependencies:
```bash
npm install
```

3. Install server dependencies:
```bash
cd server
npm install
cd ..
```

## Development

1. Start the development server:
```bash
npm run electron-dev
```

This will start both the