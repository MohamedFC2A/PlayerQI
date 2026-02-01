import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';

export default function QuestionCard({ content }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="glass-card gradient-border w-full max-w-2xl p-8 md:p-12 text-center relative overflow-visible"
        >
            {/* Question icon */}
            <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="absolute -top-5 right-1/2 translate-x-1/2 bg-gradient-to-br from-blue-500 to-purple-600 p-3 rounded-xl shadow-lg glow-blue"
            >
                <HelpCircle size={24} className="text-white" />
            </motion.div>

            {/* Question text */}
            <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-2xl md:text-3xl font-bold leading-relaxed text-white/95 mt-4"
            >
                {content}
            </motion.h2>

            {/* Decorative bottom line */}
            <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-gradient-to-r from-transparent via-blue-400/50 to-transparent"
            />
        </motion.div>
    );
}
