import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { finalizeGuessConfirmation, sendGameMove, sendGuessConfirmation } from '../lib/api';
import GameStart from '../components/GameStart';
import QuestionCard from '../components/QuestionCard';
import AnswerButtons from '../components/AnswerButtons';
import LoadingState from '../components/LoadingState';
import ResultCard from '../components/ResultCard';

const ANSWER_OPTIONS = [
    { label: 'نعم', value: 'نعم' },
    { label: 'لا', value: 'لا' },
    { label: 'ربما', value: 'ربما' },
    { label: 'لا أعرف', value: 'لا أعرف' },
];

export default function Play() {
    const [started, setStarted] = useState(false);
    const [history, setHistory] = useState([]);
    const [currentQuestion, setCurrentQuestion] = useState(null);
    const [currentQuestionMeta, setCurrentQuestionMeta] = useState(null);
    const [loading, setLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [prediction, setPrediction] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const [guessFeedback, setGuessFeedback] = useState(null);
    const [rejectedGuesses, setRejectedGuesses] = useState([]);
    const [reviewRequired, setReviewRequired] = useState(false);
    const [verification, setVerification] = useState(null);
    const [editableHistory, setEditableHistory] = useState([]);
    const [finalizing, setFinalizing] = useState(false);

    const verificationMap = useMemo(() => {
        const items = verification?.items ?? [];
        const map = new Map();
        for (const item of items) {
            if (typeof item?.index === 'number') map.set(item.index, item);
        }
        return map;
    }, [verification]);

    const fetchNextMove = async (currentHistory, nextRejectedGuesses = rejectedGuesses, sid = sessionId) => {
        setLoading(true);
        try {
            const response = await sendGameMove(currentHistory, nextRejectedGuesses, sid);
            if (response?.session_id) {
                setSessionId(response.session_id);
            }
            if (response.type === 'question') {
                setCurrentQuestion(response.content);
                setCurrentQuestionMeta({
                    question_id: response.question_id ?? null,
                    feature_id: response.feature_id ?? null,
                });
                setPrediction(null);
                setGuessFeedback(null);
                setReviewRequired(false);
                setVerification(null);
                setEditableHistory([]);
                setFinalizing(false);
            } else if (response.type === 'guess') {
                setPrediction(response);
                setCurrentQuestion(null);
                setCurrentQuestionMeta(null);
                setGuessFeedback(null);
                setReviewRequired(false);
                setVerification(null);
                setEditableHistory([]);
                setFinalizing(false);
            }
        } catch (error) {
            console.error(error);
            alert('حدث خطأ في الاتصال، يرجى المحاولة مرة أخرى.');
            if (currentHistory.length === 0) {
                setStarted(false);
            }
        } finally {
            setLoading(false);
        }
    };

    const startGame = async () => {
        setStarted(true);
        setRejectedGuesses([]);
        setSessionId(null);
        await fetchNextMove([], []);
    };

    const handleAnswer = async (answer) => {
        if (!currentQuestion) return;
        const newHistory = [
            ...history,
            {
                question: currentQuestion,
                answer,
                question_id: currentQuestionMeta?.question_id ?? null,
                feature_id: currentQuestionMeta?.feature_id ?? null,
            }
        ];
        setHistory(newHistory);
        await fetchNextMove(newHistory);
    };

    const resetGame = () => {
        setStarted(false);
        setHistory([]);
        setCurrentQuestion(null);
        setCurrentQuestionMeta(null);
        setSessionId(null);
        setPrediction(null);
        setConfirming(false);
        setGuessFeedback(null);
        setRejectedGuesses([]);
        setReviewRequired(false);
        setVerification(null);
        setEditableHistory([]);
        setFinalizing(false);
    };

    const setAnswerAt = (index, answer) => {
        setEditableHistory(prev => prev.map((h, i) => (i === index ? { ...h, answer } : h)));
    };

    const applyAllHighConfidenceSuggestions = () => {
        setEditableHistory(prev => prev.map((h, i) => {
            const item = verificationMap.get(i + 1);
            if (!item?.suggestedAnswer) return h;
            if ((item.confidence ?? 0) < 0.8) return h;
            if (item.suggestedAnswer === h.answer) return h;
            return { ...h, answer: item.suggestedAnswer };
        }));
    };

    const finalize = async () => {
        if (!prediction) return;
        setFinalizing(true);
        try {
            const result = await finalizeGuessConfirmation({ history: editableHistory, guess: prediction.content, sessionId });
            if (result?.imageUrl && !prediction.imageUrl) {
                setPrediction({ ...prediction, imageUrl: result.imageUrl });
            }
            setGuessFeedback('saved');
            setReviewRequired(false);
            setVerification(null);
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء الحفظ النهائي، حاول مرة أخرى.');
        } finally {
            setFinalizing(false);
        }
    };

    const handleGuessConfirm = async (correct) => {
        if (!prediction) return;
        setConfirming(true);
        try {
            const result = await sendGuessConfirmation({
                history,
                guess: prediction.content,
                correct,
                sessionId
            });

            if (result?.imageUrl && !prediction.imageUrl) {
                setPrediction({ ...prediction, imageUrl: result.imageUrl });
            }

            if (!correct) {
                const guessText = prediction?.content;
                const nextRejected = guessText && !rejectedGuesses.includes(guessText)
                    ? [...rejectedGuesses, guessText]
                    : rejectedGuesses;
                setRejectedGuesses(nextRejected);
                setPrediction(null);
                setCurrentQuestion(null);
                setGuessFeedback(null);
                setReviewRequired(false);
                setVerification(null);
                setEditableHistory([]);
                setFinalizing(false);
                await fetchNextMove(history, nextRejected);
                return;
            }

            if (result?.reviewRequired) {
                setReviewRequired(true);
                setVerification(result.verification ?? null);
                setEditableHistory(history);
                setGuessFeedback('review');
                return;
            }

            setGuessFeedback('saved');
        } catch (error) {
            console.error(error);
            alert('حدث خطأ أثناء حفظ النتيجة، حاول مرة أخرى.');
        } finally {
            setConfirming(false);
        }
    };

    return (
        <div className="space-y-6">
            {!started && (
                <div className="glass-card p-8 md:p-10">
                    <GameStart onStart={startGame} />
                </div>
            )}

            {started && !prediction && (
                <div className="space-y-6 w-full flex flex-col items-center">
                    <div className="w-full max-w-2xl space-y-2">
                        <div className="flex justify-between text-blue-200 text-sm font-medium px-1">
                            <span>السؤال {history.length + 1} من 15</span>
                            <span>{Math.round(((history.length + 1) / 15) * 100)}%</span>
                        </div>
                        <div className="w-full bg-white/10 rounded-full h-2.5 backdrop-blur-sm border border-white/10 overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${((history.length + 1) / 15) * 100}%` }}
                                className="bg-blue-500 h-2.5 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            />
                        </div>
                    </div>

                    {loading ? (
                        <LoadingState />
                    ) : (
                        <>
                            {currentQuestion && <QuestionCard content={currentQuestion} />}
                            <AnswerButtons onAnswer={handleAnswer} disabled={loading} />
                        </>
                    )}
                </div>
            )}

            {prediction && (
                <div className="space-y-6">
                    <ResultCard
                        guess={prediction.content}
                        reason={prediction.reason}
                        imageUrl={prediction.imageUrl}
                        onReset={resetGame}
                        onConfirm={handleGuessConfirm}
                        confirming={confirming}
                        feedback={guessFeedback}
                    />

                    {reviewRequired && (
                        <div className="glass-card p-6 md:p-8 space-y-5">
                            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                                <div className="space-y-1">
                                    <div className="text-white font-black text-xl">مراجعة الإجابات قبل الحفظ</div>
                                    <div className="text-slate-300/80 text-sm">
                                        عدّل إجاباتك لو في شيء غير دقيق، ثم اضغط حفظ نهائي.
                                    </div>
                                </div>
                                <button
                                    onClick={applyAllHighConfidenceSuggestions}
                                    disabled={finalizing}
                                    className="glass-button px-4 py-3 rounded-xl font-bold text-white bg-white/5 border-white/10 disabled:opacity-40"
                                >
                                    تطبيق اقتراحات الثقة العالية
                                </button>
                            </div>

                            <div className="space-y-4">
                                {editableHistory.map((h, i) => {
                                    const v = verificationMap.get(i + 1);
                                    const confidence = typeof v?.confidence === 'number' ? Math.round(v.confidence * 100) : null;
                                    const suggested = v?.suggestedAnswer ?? null;
                                    const reason = v?.reason ?? null;

                                    return (
                                        <div key={`${i}-${h?.question ?? ''}`} className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-3">
                                            <div className="text-slate-100 font-semibold leading-relaxed">
                                                {i + 1}) {h?.question}
                                            </div>

                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                {ANSWER_OPTIONS.map(opt => (
                                                    <button
                                                        key={opt.value}
                                                        onClick={() => setAnswerAt(i, opt.value)}
                                                        disabled={finalizing}
                                                        className={[
                                                            'glass-button px-3 py-2 rounded-xl font-bold text-white border-white/10',
                                                            h?.answer === opt.value ? 'bg-blue-600/30 border-blue-400/30' : 'bg-white/5',
                                                            finalizing ? 'opacity-40 cursor-not-allowed' : ''
                                                        ].join(' ')}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>

                                            {(suggested || reason) && (
                                                <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
                                                    {suggested && (
                                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                            <div className="text-slate-200 text-sm">
                                                                الاقتراح: <span className="font-bold text-white">{suggested}</span>
                                                                {confidence !== null && (
                                                                    <span className="text-slate-400/80"> • ثقة {confidence}%</span>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() => setAnswerAt(i, suggested)}
                                                                disabled={finalizing}
                                                                className="glass-button px-3 py-2 rounded-xl font-bold text-white bg-white/5 border-white/10 disabled:opacity-40"
                                                            >
                                                                تطبيق
                                                            </button>
                                                        </div>
                                                    )}
                                                    {reason && (
                                                        <div className="text-slate-300/80 text-sm leading-relaxed">
                                                            {reason}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            <button
                                onClick={finalize}
                                disabled={finalizing}
                                className="glass-button w-full py-4 rounded-2xl font-black text-lg text-white bg-gradient-to-r from-green-600/40 to-green-500/30 border-green-400/30 disabled:opacity-40"
                            >
                                {finalizing ? 'جارٍ الحفظ...' : 'حفظ نهائي وتحديث قاعدة البيانات'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
