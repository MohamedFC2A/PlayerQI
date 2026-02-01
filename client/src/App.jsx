import { Routes, Route } from 'react-router-dom';
import Shell from './components/Shell';
import Home from './pages/Home';
import Play from './pages/Play';
import HowTo from './pages/HowTo';

function App() {
    return (
        <Routes>
            <Route element={<Shell />}>
                <Route path="/" element={<Home />} />
                <Route path="/play" element={<Play />} />
                <Route path="/how-to" element={<HowTo />} />
            </Route>
        </Routes>
    );
}

export default App;
