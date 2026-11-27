import React from 'react';
import ShoreScene from '@components/shore';

/** Top-level `/main` page: the Shore, filling the screen. Its places, the dock and its More
 *  sheet lead to every feature page; the pet collection lives at `/pets`. */
const HomePage: React.FC = () => <ShoreScene fullscreen />;

export default HomePage;
