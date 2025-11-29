import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Brain, 
  ChevronRight, 
  RefreshCw, 
  BarChart2, 
  Maximize2, 
  Minimize2, 
  Image as ImageIcon,
  BookOpen,
  Sparkles,
  Lightbulb,
  GraduationCap,
  Bold,
  Italic,
  Sigma,
  Eye,
  Edit3,
  Save,
  Trash2,
  File
} from 'lucide-react';

const apiKey = ""; // Your Gemini API key

// --- UTILS & HELPERS ---

// Robust JSON Parsing with Auto-Repair
async function safeParseJSON(text) {
  const extractJSON = (str) => {
    const match = str.match(/\{[\s\S]*\}/);
    return match ? match[0] : str;
  };

  try {
    return JSON.parse(extractJSON(text));
  } catch (initialError) {
    console.warn("Initial JSON parse failed. Attempting AI repair...", initialError);
    try {
      // Recursive repair call
      const repairedText = await callGemini(
        `FIX THIS JSON. Return ONLY valid JSON, no markdown, no explanations. Fix syntax errors:\n\n${text}`
      );
      return JSON.parse(extractJSON(repairedText));
    } catch (repairError) {
      console.error("JSON Repair failed:", repairError);
      throw new Error("Failed to parse AI response. Please try again.");
    }
  }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- API LAYER ---

async function callGemini(prompt) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

async function callGeminiWithFiles(prompt, files) {
  try {
    const parts = [{ text: prompt }];
    files.forEach(file => {
      parts.push({
        inlineData: {
          mimeType: file.mimeType || 'application/pdf',
          data: file.data
        }
      });
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 16384
          }
        })
      }
    );
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
}

// --- PROMPTS ---

const EXAMINER_SYSTEM_PROMPT = `You are an expert GCSE Examiner known for precision and strict adherence to Assessment Objectives (AOs).
Your goal is to extract questions accurately and mark student answers with nuance.

- AO1: Knowledge & Recall (Define, State, Describe)
- AO2: Application (Explain, Apply, Calculate)
- AO3: Analysis & Evaluation (Evaluate, Justify, Compare)

When parsing papers, you must capture the exact text.
When marking, you must provide feedback broken down by these AOs where relevant.`;

const EXTRACTION_PROMPT = `${EXAMINER_SYSTEM_PROMPT}

Analyze this exam paper PDF and extract ALL questions.
Return a JSON object in this EXACT format:
{
  "questions": [
    {
      "id": "1a",
      "section": "Topic Name",
      "type": "multiple_choice|short_text|long_text|list|numerical|fill_in_blank",
      "marks": 2,
      "question": "The question text. If fill in blank, use '_____' to denote the blank.",
      "options": ["A) Text", "B) Text"] (ONLY if multiple_choice),
      "listCount": 3 (ONLY if type is 'list', e.g. 'Give three reasons'),
      "context": {
        "type": "text|image",
        "title": "Source A",
        "content": "Exact text of the source/insert related to this question.",
        "lines": "1-5"
      },
      "relatedFigure": "Description of image/diagram if present"
    }
  ]
}

CRITICAL RULES:
1. Detect "List" questions (e.g., "State three...", "Give two examples"). Set type="list" and listCount=N.
2. Detect "Fill in the blank" questions. Set type="fill_in_blank".
3. Detect "Multiple Choice". Set type="multiple_choice" and extract options array.
4. Detect "Extended writing". Set type="long_text".
Return ONLY JSON.`;

const MARKING_PROMPT_TEMPLATE = (q, previousContext, scheme, answer) => `
${EXAMINER_SYSTEM_PROMPT}

You are marking Question ${q.id} (${q.marks} marks).

QUESTION: "${q.question}"
${q.context ? `CONTEXT: ${q.context.content}` : ''}
${scheme ? `MARK SCHEME CRITERIA: ${JSON.stringify(scheme)}` : ''}

STUDENT ANSWER: "${Array.isArray(answer) ? answer.join('; ') : answer}"

Marking Instructions:
1. Award marks strictly based on the mark scheme and AOs.
2. Provide constructive feedback.
3. If the answer is vague, explain WHY.

Return JSON:
{
  "score": number,
  "feedback": "General feedback string",
  "breakdown": {
    "AO1": "Comment on knowledge (optional)",
    "AO2": "Comment on application (optional)",
    "AO3": "Comment on evaluation (optional)"
  },
  "rewrite": "A model answer correcting the student's mistakes. Use <b>bold</b> for key terms."
}`;

// --- COMPONENT: RICH TEXT EDITOR ---
const RichTextEditor = ({ value, onChange, placeholder }) => {
  const [isPreview, setIsPreview] = useState(false);

  const insertText = (tag, closeTag = '') => {
    onChange((value || '') + `${tag}text${closeTag}`);
  };

  const renderPreview = (text) => {
    if (!text) return <span className="text-slate-400 italic">Nothing typed yet...</span>;
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/\$(.*?)\$/g, '<span class="font-mono bg-yellow-50 text-yellow-700 px-1 rounded border border-yellow-200 text-xs">$1</span>') // Fake LaTeX
      .replace(/\n/g, '<br/>');
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:ring-2 focus-within:ring-indigo-500 transition-all">
      <div className="bg-slate-50 border-b border-slate-200 p-2 flex gap-2 items-center">
        <button onClick={() => insertText('**', '**')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Bold"><Bold className="w-4 h-4"/></button>
        <button onClick={() => insertText('*', '*')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Italic"><Italic className="w-4 h-4"/></button>
        <button onClick={() => insertText('$', '$')} className="p-1.5 hover:bg-slate-200 rounded text-slate-600" title="Math"><Sigma className="w-4 h-4"/></button>
        <div className="h-4 w-px bg-slate-300 mx-2"></div>
        <button 
          onClick={() => setIsPreview(!isPreview)} 
          className={`flex items-center gap-1 px-3 py-1 rounded text-xs font-bold transition-colors ${isPreview ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-200 text-slate-600'}`}
        >
          {isPreview ? <><Edit3 className="w-3 h-3"/> Edit</> : <><Eye className="w-3 h-3"/> Preview</>}
        </button>
      </div>
      
      {isPreview ? (
        <div className="w-full h-48 p-4 overflow-y-auto prose prose-sm max-w-none bg-white">
          {renderPreview(value)}
        </div>
      ) : (
        <textarea
          className="w-full h-48 p-4 outline-none resize-none font-serif leading-relaxed"
          placeholder={placeholder}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
};

// --- COMPONENT: ADAPTIVE INPUT ---
const AdaptiveInput = ({ type, options, listCount, value, onChange }) => {
  // 1. Multiple Choice
  if (type === 'multiple_choice') {
    return (
      <div className="space-y-3">
        {options?.map((opt, i) => (
          <label key={i} className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition-all ${value === opt ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-slate-200 hover:border-indigo-300'}`}>
            <input 
              type="radio" 
              name="mcq" 
              className="w-5 h-5 text-indigo-600"
              checked={value === opt}
              onChange={() => onChange(opt)} 
            />
            <span className="ml-3 font-medium text-slate-700">{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  // 2. Lists (1, 2, 3...)
  if (type === 'list') {
    const listValues = Array.isArray(value) ? value : Array(listCount || 2).fill('');
    
    const handleListChange = (idx, text) => {
      const newList = [...listValues];
      newList[idx] = text;
      onChange(newList);
    };

    return (
      <div className="space-y-4">
        {Array.from({ length: listCount || 2 }).map((_, idx) => (
          <div key={idx} className="flex items-start gap-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-bold text-sm shrink-0 border border-slate-200 mt-0.5">
              {idx + 1}
            </span>
            <input 
              type="text" 
              className="flex-1 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
              placeholder={`Point ${idx + 1}...`}
              value={listValues[idx] || ''}
              onChange={(e) => handleListChange(idx, e.target.value)}
            />
          </div>
        ))}
      </div>
    );
  }

  // 3. Fill in Blank / Short Text
  if (type === 'fill_in_blank' || type === 'short_text' || type === 'numerical') {
    return (
      <div className="relative">
        <input 
          type={type === 'numerical' ? "number" : "text"}
          className="w-full p-4 text-lg border-b-2 border-slate-300 bg-slate-50 focus:border-indigo-600 focus:bg-white outline-none transition-all rounded-t-lg"
          placeholder={type === 'numerical' ? "Enter value..." : "Type your answer here..."}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
        />
        {type === 'fill_in_blank' && (
          <span className="absolute right-4 top-4 text-xs font-bold text-slate-400 uppercase tracking-wider">
            Fill Blank
          </span>
        )}
      </div>
    );
  }

  // 4. Default: Long Text / Essay
  return (
    <RichTextEditor 
      value={value} 
      onChange={onChange}
      placeholder="Type your detailed answer here... (Markdown supported)"
    />
  );
};

// --- COMPONENT: CONTEXT PANEL ---
const ContextPanel = ({ question, insertContent, insertFileUrl }) => {
  const [viewMode, setViewMode] = useState('text'); // 'text' or 'pdf'

  return (
    <div className="h-full flex flex-col bg-slate-50 border-r border-slate-200">
      <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <h3 className="font-bold text-slate-700 text-sm">Resources</h3>
        </div>
        {insertFileUrl && (
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button 
              onClick={() => setViewMode('text')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === 'text' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Extracted Text
            </button>
            <button 
              onClick={() => setViewMode('pdf')}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === 'pdf' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Original View
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'pdf' && insertFileUrl ? (
          <iframe 
            src={`${insertFileUrl}#toolbar=0&navpanes=0&scrollbar=0`}
            className="w-full h-full bg-slate-200"
            title="Insert PDF"
          />
        ) : (
          <div className="p-6 overflow-y-auto h-full space-y-6">
             {question.context ? (
                <div className="bg-white p-5 rounded-xl border border-indigo-100 shadow-sm ring-4 ring-indigo-50">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded uppercase tracking-wider">
                      {question.context.type === 'figure' ? 'Figure' : 'Source'}
                    </span>
                    {question.context.lines && (
                      <span className="text-xs text-slate-500">Lines {question.context.lines}</span>
                    )}
                  </div>
                  <h4 className="font-serif font-bold text-lg mb-2 text-slate-800">{question.context.title}</h4>
                  <p className="font-serif leading-relaxed text-slate-700 whitespace-pre-line text-sm">
                    {question.context.content}
                  </p>
                </div>
              ) : insertContent ? (
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                   <h4 className="font-bold text-slate-700 mb-2 text-sm flex items-center gap-2">
                     <FileText className="w-4 h-4"/> Full Insert Text
                   </h4>
                   <p className="font-serif leading-relaxed text-slate-600 text-sm whitespace-pre-line">
                    {insertContent}
                   </p>
                </div>
              ) : (
                <div className="text-center py-20 text-slate-400">
                  <p>No source material needed for this question.</p>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- COMPONENT: FEEDBACK BLOCK ---
const FeedbackBlock = ({ feedback, onNext }) => {
  if (!feedback) return null;

  return (
    <div className="mt-6 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          <h3 className="font-bold">Examiner Feedback</h3>
        </div>
        <div className="font-mono bg-indigo-800 px-3 py-1 rounded-full text-sm font-bold shadow-inner">
          {feedback.score}/{feedback.totalMarks} Marks
        </div>
      </div>
      
      <div className="p-6 space-y-6">
        <div>
          <p className="text-slate-800 leading-relaxed mb-4">{feedback.text}</p>
          
          {/* AO Breakdown */}
          {feedback.breakdown && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(feedback.breakdown).map(([ao, text]) => (
                text && (
                  <div key={ao} className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs">
                    <span className="font-bold text-indigo-600 block mb-1">{ao}</span>
                    <span className="text-slate-600">{text}</span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        <div className="bg-green-50 p-5 rounded-lg border border-green-100 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <CheckCircle className="w-16 h-16 text-green-600" />
          </div>
          <h4 className="text-xs font-bold text-green-700 uppercase tracking-wider mb-2">Model Answer</h4>
          <div 
            className="text-slate-800 font-serif text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: feedback.rewrite }} 
          />
        </div>

        <button 
          onClick={onNext}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors focus:ring-4 focus:ring-indigo-200"
        >
          Next Question <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// --- MAIN APPLICATION ---

export default function Aimarker() {
  // State
  const [phase, setPhase] = useState('upload'); 
  const [files, setFiles] = useState({ paper: null, scheme: null, insert: null });
  const [insertUrl, setInsertUrl] = useState(null);
  const [error, setError] = useState(null);
  const [parsingStatus, setParsingStatus] = useState('');

  // Data State
  const [questions, setQuestions] = useState([]);
  const [insertContent, setInsertContent] = useState(null);
  const [markScheme, setMarkScheme] = useState({});

  // Exam Progress State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [feedbacks, setFeedbacks] = useState({});
  const [isMarking, setIsMarking] = useState(false);

  // Restore Progress from LocalStorage
  useEffect(() => {
    const savedData = localStorage.getItem('gcse_marker_state');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        // Only restore if we have valid data
        if (parsed.questions?.length > 0) {
          setQuestions(parsed.questions);
          setAnswers(parsed.answers || {});
          setFeedbacks(parsed.feedbacks || {});
          setCurrentIndex(parsed.currentIndex || 0);
          setInsertContent(parsed.insertContent);
          setPhase('exam');
        }
      } catch (e) {
        console.error("Failed to restore state", e);
      }
    }
  }, []);

  // Auto-Save Progress
  useEffect(() => {
    if (phase === 'exam' && questions.length > 0) {
      localStorage.setItem('gcse_marker_state', JSON.stringify({
        questions,
        answers,
        feedbacks,
        currentIndex,
        insertContent
      }));
    }
  }, [answers, feedbacks, currentIndex, phase, questions, insertContent]);

  const clearStorage = () => {
    if(window.confirm("Are you sure? This will delete your current progress.")) {
      localStorage.removeItem('gcse_marker_state');
      window.location.reload();
    }
  };

  const handleStartParsing = async () => {
    if (!files.paper) return;
    setPhase('parsing');
    setError(null);

    try {
      setParsingStatus('Digitizing exam paper...');
      const paperB64 = await fileToBase64(files.paper);
      
      let insertB64 = null;
      if (files.insert) {
        setParsingStatus('Processing source booklet...');
        insertB64 = await fileToBase64(files.insert);
        // Create Object URL for PDF view
        setInsertUrl(URL.createObjectURL(files.insert));
      }

      setParsingStatus('Examiner AI extracting questions...');
      const filesToSend = [{ mimeType: 'application/pdf', data: paperB64 }];
      let extractionPrompt = EXTRACTION_PROMPT;

      if (insertB64) {
        filesToSend.push({ mimeType: 'application/pdf', data: insertB64 });
        extractionPrompt += "\n\nNOTE: Source booklet provided as second file.";
      }

      const responseText = await callGeminiWithFiles(extractionPrompt, filesToSend);
      const parsedData = await safeParseJSON(responseText);
      
      if (!parsedData.questions || parsedData.questions.length === 0) {
        throw new Error("No questions found. Try a clearer PDF.");
      }

      setQuestions(parsedData.questions);

      if (insertB64) {
        setParsingStatus('Extracting plain text from sources...');
        const textContent = await callGeminiWithFiles(
          "Extract all text from this source booklet verbatim.",
          [{ mimeType: 'application/pdf', data: insertB64 }]
        );
        setInsertContent(textContent);
      }

      setParsingStatus('Ready to begin!');
      setTimeout(() => setPhase('exam'), 500);

    } catch (e) {
      console.error(e);
      setError(e.message);
      setPhase('upload');
    }
  };

  const handleSubmitAnswer = async () => {
    const q = questions[currentIndex];
    const answer = answers[q.id];
    // Allow submitting if answer exists (even if falsy for some types, but usually string/array)
    // For lists, we check if at least one item is filled
    const isValid = Array.isArray(answer) 
      ? answer.some(a => a && a.trim().length > 0)
      : answer && answer.trim().length > 0;

    if (!isValid) return;

    setIsMarking(true);
    
    // Construct Context
    const previousQs = questions.slice(0, currentIndex).map(pq => ({
      id: pq.id,
      q: pq.question,
      a: answers[pq.id]
    }));

    const prompt = MARKING_PROMPT_TEMPLATE(q, previousQs, markScheme[q.id], answer);

    try {
      const response = await callGemini(prompt);
      const feedbackData = await safeParseJSON(response);
      
      setFeedbacks(prev => ({
        ...prev,
        [q.id]: {
          ...feedbackData,
          totalMarks: q.marks
        }
      }));
    } catch (e) {
      console.error("Marking failed", e);
      // Fallback feedback
      setFeedbacks(prev => ({
        ...prev,
        [q.id]: {
          score: 0,
          totalMarks: q.marks,
          text: "AI service interrupted. Please try again.",
          breakdown: {},
          rewrite: "N/A"
        }
      }));
    } finally {
      setIsMarking(false);
    }
  };

  // --- RENDERERS ---

  if (phase === 'upload') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans text-slate-900">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-10 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
          
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">AI GCSE Marker</h1>
            <p className="text-slate-500 mt-2">Upload your past paper. Get instant, examiner-level feedback.</p>
          </div>

          {error && (
             <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 flex items-center gap-3 text-sm">
               <AlertCircle className="w-5 h-5 shrink-0"/> {error}
             </div>
          )}

          <div className="space-y-4">
             {/* Paper Upload */}
             <label className={`block p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${files.paper ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'}`}>
                <input type="file" className="hidden" accept=".pdf" onChange={e => setFiles(f => ({...f, paper: e.target.files[0]}))} />
                <div className="flex flex-col items-center gap-2">
                  {files.paper ? <CheckCircle className="w-8 h-8 text-indigo-600"/> : <Upload className="w-8 h-8 text-slate-400"/>}
                  <span className={`font-medium ${files.paper ? 'text-indigo-900' : 'text-slate-500'}`}>
                    {files.paper ? files.paper.name : "Upload Question Paper (PDF)"}
                  </span>
                </div>
             </label>

             {/* Optional Uploads */}
             <div className="grid grid-cols-2 gap-4">
               <label className={`block p-4 border-2 border-dashed rounded-xl cursor-pointer transition-all ${files.insert ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:bg-slate-50'}`}>
                  <input type="file" className="hidden" accept=".pdf" onChange={e => setFiles(f => ({...f, insert: e.target.files[0]}))} />
                  <div className="flex flex-col items-center text-center">
                    <span className="text-xs font-bold uppercase text-slate-400 mb-1">Optional</span>
                    <span className={`text-sm font-medium ${files.insert ? 'text-indigo-900' : 'text-slate-500'}`}>
                      {files.insert ? "Insert Uploaded" : "Source/Insert PDF"}
                    </span>
                  </div>
               </label>
               <label className={`block p-4 border-2 border-dashed rounded-xl cursor-pointer transition-all ${files.scheme ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:bg-slate-50'}`}>
                  <input type="file" className="hidden" accept=".pdf" onChange={e => setFiles(f => ({...f, scheme: e.target.files[0]}))} />
                  <div className="flex flex-col items-center text-center">
                    <span className="text-xs font-bold uppercase text-slate-400 mb-1">Optional</span>
                    <span className={`text-sm font-medium ${files.scheme ? 'text-indigo-900' : 'text-slate-500'}`}>
                      {files.scheme ? "Scheme Uploaded" : "Mark Scheme PDF"}
                    </span>
                  </div>
               </label>
             </div>
          </div>

          <button 
            onClick={handleStartParsing}
            disabled={!files.paper}
            className="w-full mt-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-200"
          >
            Start Mock Exam
          </button>
          
          {/* Restore Button check */}
          {localStorage.getItem('gcse_marker_state') && (
            <button onClick={() => {
              const data = JSON.parse(localStorage.getItem('gcse_marker_state'));
              setQuestions(data.questions);
              setAnswers(data.answers);
              setFeedbacks(data.feedbacks);
              setCurrentIndex(data.currentIndex);
              setInsertContent(data.insertContent);
              setPhase('exam');
            }} className="w-full mt-3 text-sm text-slate-500 hover:text-indigo-600 underline">
              Resume previous session?
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'parsing') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center font-mono">
        <RefreshCw className="w-12 h-12 animate-spin text-indigo-400 mb-6" />
        <h2 className="text-xl font-bold">{parsingStatus}</h2>
        <p className="text-slate-400 mt-2 text-sm">Using Gemini 1.5 Flash</p>
      </div>
    );
  }

  if (phase === 'exam') {
    const q = questions[currentIndex];
    const isLast = currentIndex === questions.length - 1;
    const hasFeedback = !!feedbacks[q.id];

    // Check if we can submit (basic validation)
    const canSubmit = (() => {
      const a = answers[q.id];
      if (Array.isArray(a)) return a.some(item => item && item.trim().length > 0);
      return a && a.toString().trim().length > 0;
    })();

    return (
      <div className="flex h-screen bg-slate-100 font-sans overflow-hidden">
        {/* Left: Resource Panel (Desktop) */}
        <div className="w-1/3 hidden lg:block h-full shadow-xl z-10">
          <ContextPanel question={q} insertContent={insertContent} insertFileUrl={insertUrl} />
        </div>

        {/* Right: Workspace */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          
          {/* Top Bar */}
          <header className="bg-white border-b border-slate-200 p-4 flex justify-between items-center shrink-0">
             <div className="flex items-center gap-4">
                <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded text-sm font-bold">Q{currentIndex + 1} / {questions.length}</span>
                <span className="text-slate-500 text-sm hidden sm:inline">Mock Paper Assessment</span>
             </div>
             <div className="flex items-center gap-3">
               <button onClick={clearStorage} title="Reset Progress" className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                 <Trash2 className="w-4 h-4" />
               </button>
               <button onClick={() => alert("Progress saved automatically.")} className="flex items-center gap-2 text-xs font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                 <Save className="w-3 h-3" /> Auto-Saved
               </button>
             </div>
          </header>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:p-12 scroll-smooth">
            <div className="max-w-3xl mx-auto pb-32">
              
              {/* Question Card */}
              <div className="mb-8">
                 <div className="flex items-center gap-3 mb-4">
                   <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{q.section || "General"}</span>
                   <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-xs font-bold border border-orange-200">{q.marks} Marks</span>
                 </div>
                 <h2 className="text-2xl md:text-3xl font-bold text-slate-800 leading-tight">
                   <span className="text-slate-300 select-none mr-3">{q.id}.</span>
                   {q.question}
                 </h2>
              </div>

              {/* Answer Input */}
              <div className={`transition-all duration-500 ${hasFeedback ? 'opacity-50 pointer-events-none grayscale-[0.5]' : ''}`}>
                 <AdaptiveInput 
                    type={q.type}
                    options={q.options}
                    listCount={q.listCount}
                    value={answers[q.id]}
                    onChange={(val) => setAnswers(prev => ({...prev, [q.id]: val}))}
                 />
              </div>

              {/* Actions */}
              {!hasFeedback && (
                <div className="mt-8 flex justify-end">
                  <button 
                    onClick={handleSubmitAnswer}
                    disabled={!canSubmit || isMarking}
                    className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl"
                  >
                    {isMarking ? <><RefreshCw className="w-4 h-4 animate-spin"/> Marking...</> : <><CheckCircle className="w-4 h-4"/> Submit Answer</>}
                  </button>
                </div>
              )}

              {/* Feedback */}
              <FeedbackBlock 
                feedback={feedbacks[q.id]} 
                onNext={() => {
                  if(isLast) {
                    setPhase('summary');
                  } else {
                    setCurrentIndex(c => c + 1);
                  }
                }} 
              />
            </div>
          </div>

        </div>
      </div>
    );
  }

  // Summary Phase (Simple implementation for now)
  if (phase === 'summary') {
    const totalScore = Object.values(feedbacks).reduce((acc, f) => acc + (f.score || 0), 0);
    const maxScore = questions.reduce((acc, q) => acc + (q.marks || 0), 0);
    const percentage = Math.round((totalScore / maxScore) * 100);

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white p-10 rounded-3xl shadow-2xl text-center max-w-lg w-full">
          <div className="w-24 h-24 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 text-white text-3xl font-bold shadow-lg shadow-indigo-200">
            {percentage}%
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Assessment Complete</h2>
          <p className="text-slate-500 mb-8">You scored {totalScore} out of {maxScore} marks.</p>
          
          <button onClick={() => window.location.reload()} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold w-full hover:bg-slate-800">
            Start New Paper
          </button>
        </div>
      </div>
    );
  }

  return null;
}