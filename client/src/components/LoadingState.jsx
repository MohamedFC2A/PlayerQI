import { motion } from 'framer-motion';
import { Brain, Sparkles } from 'lucide-react';

export default function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center space-y-6 py-16">
            {/* Animated brain icon with glow */}
            <motion.div
                animate={{
                    scale: [1, 1.1, 1],
                }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                className="relative"
            >
                {/* Outer glow ring */}
                <motion.div
                    animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0.1, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-blue-500/40 blur-2xl rounded-full"
                />

                {/* Icon container */}
                <div className="relative z-10 p-5 bg-gradient-to-br from-blue-500/30 to-purple-500/20 rounded-2xl border border-white/10 backdrop-blur-sm">
                    <motion.div
                        animate={{ rotate: [0, 5, -5, 0] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <Brain size={56} className="text-blue-400" />
                    </motion.div>
                </div>

                {/* Floating sparkles */}
                <motion.div
                    animate={{ y: [0, -10, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
                    className="absolute -top-2 -right-2"
                >
                    <Sparkles size={16} className="text-cyan-400" />
                </motion.div>
                <motion.div
                    animate={{ y: [0, -8, 0], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: 0.6 }}
                    className="absolute -bottom-1 -left-2"
                >
                    <Sparkles size={12} className="text-purple-400" />
                </motion.div>
            </motion.div>

            {/* Loading text with dots animation */}
            <div className="text-center space-y-2">
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-blue-200 text-lg font-semibold"
                >
                    جاري تحليل إجاباتك
                    <motion.span
                        animate={{ opacity: [0, 1, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                    >...</motion.span>
                </motion.p>
                <p className="text-slate-400 text-sm">
                    الذكاء الاصطناعي يفكر 🧠
                </p>
            </div>

            {/* Progress dots */}
            <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        animate={{
                            scale: [1, 1.3, 1],
                            backgroundColor: ['rgba(59,130,246,0.5)', 'rgba(59,130,246,1)', 'rgba(59,130,246,0.5)']
                        }}
                        transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.2
                        }}
                        className="w-2 h-2 rounded-full bg-blue-500"
                    />
                ))}
            </div>
        </div>
    );
}
