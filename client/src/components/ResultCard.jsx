import { motion } from 'framer-motion';
import { Trophy, RotateCcw, Sparkles, Star } from 'lucide-react';

// Confetti particle component
const Particle = ({ delay, x }) => (
    <motion.div
        initial={{ y: -20, x: 0, opacity: 1, scale: 1 }}
        animate={{
            y: 400,
            x: x,
            opacity: 0,
            scale: 0.5,
            rotate: 360 * (Math.random() > 0.5 ? 1 : -1)
        }}
        transition={{
            duration: 2.5,
            delay: delay,
            ease: "easeOut"
        }}
        className="absolute top-0 w-2 h-2 rounded-full"
        style={{
            left: `${20 + Math.random() * 60}%`,
            background: ['#60a5fa', '#a78bfa', '#22d3ee', '#f59e0b', '#10b981'][Math.floor(Math.random() * 5)]
        }}
    />
);

export default function ResultCard({ guess, reason, imageUrl, onReset, onConfirm, confirming, feedback }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="glass-card max-w-md w-full p-8 text-center space-y-6 mx-auto relative overflow-hidden celebration-glow"
        >
            {/* Confetti particles */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {[...Array(12)].map((_, i) => (
                    <Particle key={i} delay={i * 0.1} x={(Math.random() - 0.5) * 100} />
                ))}
            </div>

            {/* Floating stars decoration */}
            <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute top-4 right-4"
            >
                <Star size={16} className="text-yellow-400/40 fill-yellow-400/40" />
            </motion.div>
            <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                className="absolute top-8 left-6"
            >
                <Star size={12} className="text-blue-400/40 fill-blue-400/40" />
            </motion.div>

            {/* Trophy section */}
            <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="flex justify-center relative"
            >
                <div className="relative">
                    <div className="p-5 bg-gradient-to-br from-yellow-500/30 to-amber-600/20 rounded-2xl shadow-2xl border border-yellow-400/20 glow-yellow">
                        <Trophy size={56} className="text-yellow-400 drop-shadow-lg" />
                    </div>
                    {/* Sparkle decorations */}
                    <motion.div
                        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="absolute -top-2 -right-2"
                    >
                        <Sparkles size={20} className="text-yellow-300" />
                    </motion.div>
                </div>
            </motion.div>

            {/* Guess content */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-3"
            >
                <p className="text-blue-200/80 text-lg font-medium">
                    أعتقد أن اللاعب هو:
                </p>
                <h2 className="text-4xl md:text-5xl font-black shimmer-text tracking-tight">
                    {guess}
                </h2>
            </motion.div>

            {Boolean(imageUrl) && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5 }}
                    className="flex justify-center"
                >
                    <img
                        src={imageUrl}
                        alt={guess}
                        className="w-40 h-40 rounded-2xl object-cover border border-white/10 shadow-2xl"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                </motion.div>
            )}

            {/* Reason box */}
            {Boolean(reason) && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6 }}
                    className="bg-black/30 rounded-xl p-5 text-slate-200/90 text-sm leading-relaxed border border-white/5 backdrop-blur-sm"
                >
                    <div className="flex items-start gap-2">
                        <Sparkles size={16} className="text-blue-400 mt-0.5 shrink-0" />
                        <p>{reason}</p>
                    </div>
                </motion.div>
            )}

            {typeof onConfirm === 'function' && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.65 }}
                    className="space-y-3"
                >
                    <div className="text-slate-200/90 font-semibold">
                        هل التخمين صحيح؟
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => onConfirm(true)}
                            disabled={confirming || Boolean(feedback)}
                            className="glass-button py-3 rounded-xl font-bold text-white bg-gradient-to-r from-green-600/40 to-green-500/30 border-green-400/30 disabled:opacity-40"
                        >
                            نعم
                        </button>
                        <button
                            onClick={() => onConfirm(false)}
                            disabled={confirming || Boolean(feedback)}
                            className="glass-button py-3 rounded-xl font-bold text-white bg-gradient-to-r from-red-600/40 to-red-500/30 border-red-400/30 disabled:opacity-40"
                        >
                            لا
                        </button>
                    </div>
                    {feedback === 'review' && (
                        <div className="text-blue-200 font-medium">
                            راجع إجاباتك للتأكد قبل الحفظ النهائي.
                        </div>
                    )}
                    {feedback === 'saved' && (
                        <div className="text-green-300 font-medium">
                            تم حفظ اللاعب وتحديث قاعدة البيانات.
                        </div>
                    )}
                    {feedback === 'wrong' && (
                        <div className="text-red-300 font-medium">
                            تم تسجيل أن التخمين غير صحيح.
                        </div>
                    )}
                </motion.div>
            )}

            {/* Play again button */}
            <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onReset}
                className="glass-button w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 text-white bg-gradient-to-r from-blue-600/40 to-blue-500/30 hover:from-blue-500/50 hover:to-blue-400/40 border-blue-400/30"
            >
                <motion.div
                    animate={{ rotate: [0, -360] }}
                    transition={{ duration: 0.5 }}
                    whileHover={{ rotate: -360 }}
                >
                    <RotateCcw size={22} />
                </motion.div>
                <span>لعب مرة أخرى</span>
            </motion.button>
        </motion.div>
    );
}
