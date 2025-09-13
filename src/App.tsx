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
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

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
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Check if speech recognition is supported
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognitionAPI) {
      setError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
      return;
    }

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
      setError('Network connection lost. Please check your internet connection.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check microphone permission
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then((permissionStatus) => {
        setMicPermission(permissionStatus.state);
        
        permissionStatus.onchange = () => {
          setMicPermission(permissionStatus.state);
        };
      })
      .catch(() => {
        // Fallback for browsers that don't support permissions API
        setMicPermission('prompt');
      });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [isRecording, error]);

  const startRecording = async () => {
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
      
      // Add more robust error handling
      let restartTimeout: ReturnType<typeof setTimeout>;

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
        console.error('Speech recognition error:', event.error);
        
        // Handle different types of errors
        switch (event.error) {
          case 'network':
            setNetworkRetryCount(prev => prev + 1);
            if (networkRetryCount < 3) {
              setError(`Network connection issue (attempt ${networkRetryCount + 1}/3). Retrying...`);
              // Retry after 2 seconds
              setTimeout(() => {
                if (isOnline && recognitionRef.current) {
                  try {
                    recognitionRef.current.start();
                  } catch (err) {
                    console.error('Failed to restart after network error:', err);
                  }
                }
              }, 2000);
            } else {
              setError('Network connection issues persist. Please check your internet connection and try refreshing the page. Speech recognition may work better when deployed to a server with HTTPS.');
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
            setError('Speech recognition service not available. This often happens on localhost. Try deploying to a server with HTTPS or use Chrome/Edge.');
            setIsRecording(false);
            setInterimTranscription('');
            break;
          default:
            setError(`Speech recognition error: ${event.error}. If this persists, try using the app on a server with HTTPS.`);
            setIsRecording(false);
            setInterimTranscription('');
        }
      };

      recognition.onend = () => {
        // Only stop if we're not supposed to be recording
        if (isRecording) {
          // Try to restart after a brief delay if we were recording
          restartTimeout = setTimeout(() => {
            if (recognitionRef.current && isRecording) {
              try {
                recognitionRef.current.start();
              } catch (err) {
                console.error('Failed to restart recognition:', err);
                setIsRecording(false);
                setInterimTranscription('');
              }
            }
          }, 100);
        } else {
          setIsRecording(false);
          setInterimTranscription('');
        }
      };

      recognition.onstart = () => {
        setIsRecording(true);
        setError('');
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
    <div className="min-h-screen bg-white text-black flex flex-col">
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
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-4xl mx-auto">
          
          {/* Error Message */}
          {error && (
            <div className="mb-8 p-4 bg-gray-100 border border-gray-300 rounded-lg text-sm text-gray-700">
              <div className="flex items-center justify-between">
                <span>{error}</span>
                {(error.includes('Network') || error.includes('network')) && (
                  <button
                    onClick={retryConnection}
                    className="ml-4 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
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
              disabled={!!error}
              className={`
                relative p-6 rounded-full border-2 transition-all duration-300 transform hover:scale-105
                ${isRecording 
                  ? 'border-black bg-black text-white shadow-lg' 
                  : 'border-gray-300 bg-white text-black hover:border-black'
                }
                ${error ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {isRecording ? (
                <>
                  <MicOff size={32} />
                  <div className="absolute inset-0 rounded-full border-2 border-black animate-ping opacity-25"></div>
                </>
              ) : (
                <Mic size={32} />
              )}
            </button>
          </div>

          <div className="text-center mb-8">
            <p className="text-lg font-light">
              {isRecording ? 'Listening...' : 'Click the microphone to start'}
            </p>
            {micPermission === 'denied' && (
              <p className="text-sm text-gray-500 mt-2">
                Please enable microphone access in your browser settings
              </p>
            )}
            {window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && (
              <p className="text-sm text-yellow-600 mt-2">
                ⚠️ For best performance, use HTTPS. Some speech recognition features may be limited on HTTP.
              </p>
            )}
            {window.location.hostname === 'localhost' && (
              <p className="text-sm text-blue-600 mt-2">
                💡 Running locally. If you experience network errors, try deploying to a server with HTTPS.
              </p>
            )}
          </div>

          {/* Transcription Area */}
          <div className="relative">
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-700">Transcription</span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={toggleEdit}
                    className="p-2 hover:bg-gray-200 rounded transition-colors duration-200"
                    title={isEditing ? 'Stop editing' : 'Edit text'}
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={copyToClipboard}
                    disabled={!transcription}
                    className="p-2 hover:bg-gray-200 rounded transition-colors duration-200 disabled:opacity-50"
                    title="Copy to clipboard"
                  >
                    {isCopied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </button>
                  <button
                    onClick={clearTranscription}
                    disabled={!transcription}
                    className="px-3 py-1 text-sm hover:bg-gray-200 rounded transition-colors duration-200 disabled:opacity-50"
                    title="Clear transcription"
                  >
                    Clear
                  </button>
                </div>
              </div>
              
              <div className="p-4">
                {isEditing ? (
                  <textarea
                    ref={textareaRef}
                    value={transcription}
                    onChange={handleTextChange}
                    className="w-full h-64 resize-none border-none outline-none text-lg leading-relaxed"
                    placeholder="Your transcribed text will appear here..."
                  />
                ) : (
                  <div className="min-h-64 text-lg leading-relaxed">
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
            <div className="inline-flex items-center space-x-4 text-sm text-gray-500">
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
      <footer className="border-t border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <p>Data is stored temporarily and will be cleared when you close this tab.</p>
          <p className="mt-1">
            💡 For best performance and reliability, deploy this app to a server with HTTPS (like Vercel, Netlify, or GitHub Pages).
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;