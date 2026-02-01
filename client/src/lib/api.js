import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
});

export const sendGameMove = async (history, rejectedGuesses = [], sessionId = null) => {
    try {
        const response = await api.post('/game', { history, rejectedGuesses, session_id: sessionId });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

export const sendGuessConfirmation = async ({ history, guess, correct, sessionId = null }) => {
    try {
        const response = await api.post('/confirm', { history, guess, correct, session_id: sessionId });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

export const finalizeGuessConfirmation = async ({ history, guess, sessionId = null }) => {
    try {
        const response = await api.post('/confirm-final', { history, guess, session_id: sessionId });
        return response.data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};
