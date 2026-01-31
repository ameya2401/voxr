import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Copy, Edit3, Check } from 'lucide-react';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  onstart: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new(): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new(): SpeechRecognition;
    };
  }
}

// Detect Brave browser
const isBrave = (): boolean => {
  return (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave !== undefined;
};

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [interimTranscription, setInterimTranscription] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState('');
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [networkRetryCount, setNetworkRetryCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBraveBrowser, setIsBraveBrowser] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timeoutRefs = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});
  const isRestartingRef = useRef(false);

  useEffect(() => {
    // Check if running in Brave browser
    setIsBraveBrowser(isBrave());

    // Initialize speech recognition availability check
    const initializeSpeechRecognition = async () => {
      setIsInitializing(true);

      // Check if speech recognition API exists in the browser
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognitionAPI) {
        setError('Speech recognition is not supported in this browser. Please open this page in Chrome, Edge, or Safari.');
        setSpeechSupported(false);
        setIsInitializing(false);
        return;
      }

      // API exists - assume it's supported and let user try
      // Actual errors will be caught when user starts recording
      setSpeechSupported(true);
      setIsInitializing(false);

      // Check microphone permission status (non-blocking)
      try {
        const permissionStatus = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
        if (permissionStatus) {
          setMicPermission(permissionStatus.state);
          permissionStatus.onchange = () => {
            setMicPermission(permissionStatus.state);
          };
        }
      } catch {
        // Permissions API not supported, that's fine
        setMicPermission('prompt');
      }
    };

    initializeSpeechRecognition();

    // Monitor network status
    const handleOnline = () => {
      setIsOnline(true);
      setNetworkRetryCount(0);
      if (error.includes('Network') || error.includes('network')) {
        setError('');
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      if (isRecording) {
        stopRecording();
      }
      setError('Network connection lost. Speech recognition requires an internet connection.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);

      // Clear all timeouts
      Object.values(timeoutRefs.current).forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current = {};

      isRestartingRef.current = false;

      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    if (!speechSupported) {
      setError('Speech recognition is not available. Please refresh the page and try again.');
      return;
    }

    if (!isOnline) {
      setError('Internet connection required for speech recognition. Please check your connection.');
      return;
    }

    try {
      // Clear any previous errors
      setError('');

      // Request microphone access
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognitionAPI();

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      // Add connection timeout
      timeoutRefs.current.connection = setTimeout(() => {
        recognition.stop();
        setError('Connection timeout. Speech recognition service is not responding. Please try again.');
        setIsRecording(false);
        setInterimTranscription('');
      }, 15000); // 15 second timeout

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setTranscription((prev: string) => prev + finalTranscript);
        }

        setInterimTranscription(interimTranscript);
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (timeoutRefs.current.connection) {
          clearTimeout(timeoutRefs.current.connection);
          delete timeoutRefs.current.connection;
        }
        console.error('Speech recognition error:', event.error);

        // Handle different types of errors
        switch (event.error) {
          case 'network':
            // Check if it's Brave browser - likely blocked by shields
            if (isBraveBrowser) {
              setError('BRAVE_BLOCKED');
              setIsRecording(false);
              setInterimTranscription('');
              return;
            }
            setNetworkRetryCount(prev => prev + 1);
            if (networkRetryCount < 2) {
              setError(`Network issue (attempt ${networkRetryCount + 1}/3). Retrying in 3 seconds...`);
              // Retry after 3 seconds
              timeoutRefs.current.retry = setTimeout(() => {
                if (isOnline && speechSupported && !isRestartingRef.current) {
                  startRecording();
                }
              }, 3000);
            } else {
              setError('Persistent network issues. Please check your internet connection, refresh the page, or try a different browser (Chrome recommended).');
              setIsRecording(false);
              setInterimTranscription('');
            }
            break;
          case 'not-allowed':
            setError('Microphone access denied. Please allow microphone access and refresh the page.');
            setMicPermission('denied');
            setIsRecording(false);
            setInterimTranscription('');
            break;
          case 'no-speech':
            // Don't show error for no speech, just continue listening
            return;
          case 'audio-capture':
            setError('No microphone found. Please connect a microphone and try again.');
            setIsRecording(false);
            setInterimTranscription('');
            break;
          case 'service-not-allowed':
            setError('Speech recognition service blocked. This can happen due to browser settings or corporate firewalls. Try using Chrome or refreshing the page.');
            setIsRecording(false);
            setInterimTranscription('');
            break;
          case 'aborted':
            // Don't show error for aborted, user likely stopped intentionally
            setIsRecording(false);
            setInterimTranscription('');
            break;
          default:
            setError(`Speech recognition error: ${event.error}. Try refreshing the page or using Chrome browser.`);
            setIsRecording(false);
            setInterimTranscription('');
        }
      };

      recognition.onend = () => {
        // Only restart if we're supposed to be recording and not already restarting
        if (isRecording && !isRestartingRef.current) {
          isRestartingRef.current = true;
          // Try to restart after a brief delay if we were recording
          timeoutRefs.current.restart = setTimeout(() => {
            if (recognitionRef.current && isRecording && !isRestartingRef.current) {
              try {
                recognitionRef.current.start();
              } catch (err) {
                console.error('Failed to restart recognition:', err);
                setIsRecording(false);
                setInterimTranscription('');
                isRestartingRef.current = false;
              }
            }
          }, 100);
        } else {
          setIsRecording(false);
          setInterimTranscription('');
          isRestartingRef.current = false;
        }
      };

      recognition.onstart = () => {
        if (timeoutRefs.current.connection) {
          clearTimeout(timeoutRefs.current.connection);
          delete timeoutRefs.current.connection;
        }
        setIsRecording(true);
        setError('');
        setNetworkRetryCount(0); // Reset retry count on successful start
        isRestartingRef.current = false; // Reset restart flag
      };

      recognitionRef.current = recognition;
      recognition.start();

    } catch (err) {
      console.error('Failed to start recording:', err);
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError') {
          setError('Microphone access denied. Please allow microphone access and try again.');
          setMicPermission('denied');
        } else if (err.name === 'NotFoundError') {
          setError('No microphone found. Please connect a microphone and try again.');
        } else {
          setError('Failed to access microphone. Please try again.');
        }
      } else {
        setError('Failed to start speech recognition. Please try again.');
      }
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    // Clear all timeouts
    Object.values(timeoutRefs.current).forEach(timeout => clearTimeout(timeout));
    timeoutRefs.current = {};

    isRestartingRef.current = false;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
    setInterimTranscription('');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Space bar to toggle recording
    if (event.code === 'Space' && !isEditing) {
      event.preventDefault();
      toggleRecording();
    }
    // Escape to stop recording or exit edit mode
    if (event.code === 'Escape') {
      if (isRecording) {
        stopRecording();
      } else if (isEditing) {
        setIsEditing(false);
      }
    }
    // Enter to start editing (when not already editing)
    if (event.code === 'Enter' && !isEditing && transcription) {
      event.preventDefault();
      toggleEdit();
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(transcription);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };

  const toggleEdit = () => {
    setIsEditing(!isEditing);
    if (!isEditing) {
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(transcription.length, transcription.length);
        }
      }, 100);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setTranscription(e.target.value);
  };

  const clearTranscription = () => {
    setTranscription('');
    setInterimTranscription('');
  };

  const retryConnection = () => {
    setError('');
    setNetworkRetryCount(0);
    if (!isRecording) {
      startRecording();
    }
  };

  return (
    <div className="min-h-screen bg-white text-black flex flex-col" onKeyDown={handleKeyDown} tabIndex={-1}>
      {/* Header */}
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-light tracking-wide">Speech to Text</h1>
          <div className="text-sm text-gray-500">
            Real-time transcription
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 md:px-6 py-8 md:py-12">
        <div className="w-full max-w-4xl mx-auto">

          {/* Keyboard shortcuts info */}
          <div className="mb-4 text-center">
            <details className="text-sm text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">Keyboard Shortcuts</summary>
              <div className="mt-2 space-y-1">
                <p><kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Space</kbd> - Toggle recording</p>
                <p><kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Escape</kbd> - Stop recording or exit edit</p>
                <p><kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Enter</kbd> - Edit transcription</p>
              </div>
            </details>
          </div>

          {/* Initialization Status */}
          {isInitializing && (
            <div className="mb-8 p-4 bg-blue-100 border border-blue-300 rounded-lg text-sm text-blue-700">
              <div className="flex items-center">
                <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3"></div>
                Initializing speech recognition... Please allow microphone access if prompted.
              </div>
            </div>
          )}

          {/* Brave Browser Warning */}
          {isBraveBrowser && !error && (
            <div className="mb-8 p-4 bg-orange-100 border border-orange-300 rounded-lg text-sm text-orange-800">
              <div className="font-medium mb-2">🦁 Brave Browser Detected</div>
              <p className="mb-2">Brave blocks speech recognition by default for privacy. To enable it:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Click the <strong>Brave Shields icon</strong> (lion icon) in the address bar</li>
                <li>Turn <strong>Shields OFF</strong> for this site, OR</li>
                <li>Click "Advanced controls" → Set "Block fingerprinting" to <strong>Allow</strong></li>
                <li>Refresh the page after making changes</li>
              </ol>
            </div>
          )}

          {/* Brave Blocked Error */}
          {error === 'BRAVE_BLOCKED' && (
            <div className="mb-8 p-4 bg-orange-100 border border-orange-300 rounded-lg text-sm text-orange-800">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium mb-2">🦁 Speech Recognition Blocked by Brave Shields</div>
                  <p className="mb-3">Brave's privacy shields are blocking the speech recognition service. To fix this:</p>
                  <ol className="list-decimal list-inside space-y-2 mb-3">
                    <li>Click the <strong>Brave Shields icon</strong> (lion) in the address bar</li>
                    <li>Toggle <strong>Shields OFF</strong> for this site</li>
                    <li>Click the button below to retry</li>
                  </ol>
                  <p className="text-xs text-orange-600">Alternatively, use Chrome or Edge for full compatibility without disabling shields.</p>
                </div>
                <button
                  onClick={() => { setError(''); retryConnection(); }}
                  className="ml-4 px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors flex-shrink-0"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && error !== 'BRAVE_BLOCKED' && (
            <div className="mb-8 p-4 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-700">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium mb-2">Issue Detected:</div>
                  <div>{error}</div>
                  {(error.includes('network') || error.includes('Network') || error.includes('localhost')) && (
                    <div className="mt-3 text-xs text-gray-600">
                      <strong>Troubleshooting tips:</strong>
                      <ul className="list-disc list-inside mt-1 space-y-1">
                        <li>Check your internet connection</li>
                        <li>For localhost development: Access via network IP (check terminal)</li>
                        <li>Use Chrome browser for best compatibility</li>
                        <li>Try using a tunneling service like ngrok for HTTPS</li>
                        <li>Disable VPN if you're using one</li>
                        <li>Check if your firewall is blocking the service</li>
                      </ul>
                    </div>
                  )}
                </div>
                {(error.includes('Network') || error.includes('network') || error.includes('localhost')) && (
                  <button
                    onClick={retryConnection}
                    className="ml-4 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex-shrink-0"
                  >
                    Retry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Network Status */}
          {!isOnline && (
            <div className="mb-8 p-4 bg-red-100 border border-red-300 rounded-lg text-sm text-red-700">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-red-500 rounded-full mr-2"></div>
                You are currently offline. Speech recognition requires an internet connection.
              </div>
            </div>
          )}

          {/* Recording Controls */}
          <div className="flex items-center justify-center mb-8">
            <button
              onClick={toggleRecording}
              disabled={(!!error && error !== 'BRAVE_BLOCKED') || isInitializing || !speechSupported}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              aria-pressed={isRecording}
              className={`
                relative p-8 md:p-6 rounded-full border-2 transition-all duration-300 transform active:scale-95 touch-manipulation
                ${isRecording
                  ? 'border-black bg-black text-white shadow-lg'
                  : 'border-gray-300 bg-white text-black hover:border-black active:bg-gray-50'
                }
                ${(error && error !== 'BRAVE_BLOCKED') || isInitializing || !speechSupported ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isRecording ? (
                <>
                  <MicOff size={40} className="md:w-8 md:h-8" />
                  <div className="absolute inset-0 rounded-full border-2 border-black animate-ping opacity-25"></div>
                </>
              ) : (
                <Mic size={40} className="md:w-8 md:h-8" />
              )}
            </button>
          </div>

          <div className="text-center mb-8">
            <p className="text-xl md:text-lg font-light">
              {isInitializing ? 'Setting up speech recognition...' :
                isRecording ? 'Listening...' :
                  !speechSupported ? 'Speech recognition unavailable' :
                    'Tap the microphone to start'}
            </p>
            {micPermission === 'denied' && (
              <p className="text-sm text-gray-500 mt-2">
                Please enable microphone access in your browser settings
              </p>
            )}
            {!speechSupported && !isInitializing && (
              <p className="text-sm text-red-600 mt-2">
                Speech recognition service is not available. Please refresh the page or try a different browser.
              </p>
            )}
            {(window.location.protocol === 'http:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
              <p className="text-sm text-yellow-600 mt-2">
                ⚠️ Speech recognition works best on HTTPS. For development, try accessing via your network IP address (check terminal output) or use a tunneling service like ngrok.
              </p>
            )}
            {speechSupported && !error && (
              <p className="text-sm text-green-600 mt-2">
                ✅ Speech recognition is ready. Make sure you have a stable internet connection.
              </p>
            )}
          </div>

          {/* Transcription Area */}
          <div className="relative">
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-3 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-700">Transcription</span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={toggleEdit}
                    aria-label={isEditing ? 'Stop editing' : 'Edit text'}
                    className="p-2 hover:bg-gray-200 rounded transition-colors duration-200 touch-manipulation"
                    title={isEditing ? 'Stop editing' : 'Edit text'}
                  >
                    <Edit3 size={18} className="md:w-4 md:h-4" />
                  </button>
                  <button
                    onClick={copyToClipboard}
                    disabled={!transcription}
                    aria-label="Copy transcription to clipboard"
                    className="p-2 hover:bg-gray-200 rounded transition-colors duration-200 disabled:opacity-50 touch-manipulation"
                    title="Copy to clipboard"
                  >
                    {isCopied ? <Check size={18} className="text-green-600 md:w-4 md:h-4" /> : <Copy size={18} className="md:w-4 md:h-4" />}
                  </button>
                  <button
                    onClick={clearTranscription}
                    disabled={!transcription}
                    aria-label="Clear transcription"
                    className="px-3 py-1 text-sm hover:bg-gray-200 rounded transition-colors duration-200 disabled:opacity-50 touch-manipulation"
                    title="Clear transcription"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="p-4" data-selectable="true">
                {isEditing ? (
                  <textarea
                    ref={textareaRef}
                    value={transcription}
                    onChange={handleTextChange}
                    aria-label="Edit transcription text"
                    className="w-full h-64 md:h-80 resize-none border-none outline-none text-lg leading-relaxed touch-manipulation"
                    placeholder="Your transcribed text will appear here..."
                  />
                ) : (
                  <div className="min-h-64 md:min-h-80 text-lg leading-relaxed" role="region" aria-label="Transcribed text">
                    {transcription && (
                      <span>{transcription}</span>
                    )}
                    {interimTranscription && (
                      <span className="text-gray-400 italic">{interimTranscription}</span>
                    )}
                    {!transcription && !interimTranscription && (
                      <p className="text-gray-400 italic">Your transcribed text will appear here...</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status Bar */}
          <div className="mt-6 text-center">
            <div className="inline-flex items-center space-x-4 text-sm text-gray-500 flex-wrap justify-center gap-2">
              <span>Words: {transcription.trim().split(/\s+/).filter(word => word.length > 0).length}</span>
              <span>Characters: {transcription.length}</span>
              <span className="flex items-center">
                <div className={`w-2 h-2 rounded-full mr-2 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`}></div>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              {isRecording && (
                <span className="flex items-center">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></div>
                  Recording
                </span>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 px-4 md:px-6 py-4">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <p>Data is stored temporarily and will be cleared when you close this tab.</p>
          <p className="mt-1">
            💡 For best speech recognition performance: Use Chrome browser, ensure stable internet, and speak clearly.
          </p>
          {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
            <p className="mt-2 text-blue-600">
              🔧 Development mode: If speech recognition doesn't work, try accessing via your network IP address or use ngrok for HTTPS.
            </p>
          )}
          {!speechSupported && (
            <p className="mt-2 text-blue-600">
              📝 Speech recognition unavailable? You can still manually edit text in the transcription area above.
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;