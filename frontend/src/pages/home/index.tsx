import React from 'react';
import PetGallery from '@components/pet/collection/pet-gallery';
import ShoreScene from '@components/shore';

/** Top-level `/main` page: the Shore scene, then the gallery (stat strip + pet collection).
 *  The Shore's places and the shell sidebar both lead to the feature pages. */
const HomePage: React.FC = () => (
    <>
        <ShoreScene />
        <PetGallery />
    </>
);

export default HomePage;
