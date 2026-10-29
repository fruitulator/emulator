import type { PosterArt } from './proplist';
import posterBalloon from './posters/balloon.jpg?url';
import posterCirque from './posters/cirque.jpg?url';
import posterTrapeze from './posters/trapeze.jpg?url';
import posterShowmen from './posters/showmen.jpg?url';
import posterClowns from './posters/clowns.jpg?url';
import posterConey from './posters/coneyisland.jpg?url';
import posterWater from './posters/watercircus.jpg?url';
import posterLady from './posters/ladyclown.jpg?url';
import posterBicycles from './posters/bicycles.jpg?url';

export const POSTER_URLS: Record<PosterArt, string> = {
  balloon: posterBalloon, cirque: posterCirque, trapeze: posterTrapeze, showmen: posterShowmen, clowns: posterClowns,
  coneyisland: posterConey, watercircus: posterWater, ladyclown: posterLady, bicycles: posterBicycles,
};
