import React from 'react';
import TitleScreen from '@components/game/title-screen';
import ShoreScene from '@components/shore';

/** Top-level `/main` page: the Shore, filling the screen. Its places, the dock and its More
 *  sheet lead to every feature page; the pet collection lives at `/pets`. The title screen
 *  greets the first visit home in a session. */
const HomePage: React.FC = () => (
    <>
        <ShoreScene fullscreen />
        <TitleScreen />
    </>
);

export default HomePage;
