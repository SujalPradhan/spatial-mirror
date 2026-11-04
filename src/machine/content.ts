export const sources=[
 {label:'Howe (1846) · US Patent 4,750, Sewing-machine',url:'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6814015'},
 {label:'A lockstitch reference: how the 301 stitch forms and how its timing is set',url:'https://cdn.shopify.com/s/files/1/0554/2631/8530/files/301-STITCH-BOOK.pdf'},
 {label:'The invention of the sewing machine · Encyclopedia.com',url:'https://www.encyclopedia.com/science/encyclopedias-almanacs-transcripts-and-maps/invention-sewing-machine'},
];
/** One line per hand mode, for the About panel. */
export const machineModes=[
 'Open hand draws with thread: the feed dog drops and your hand steers the cloth, which slides the other way so the needle traces your path; a stitch regulator paces the needle to your hand, and the last 400 stitches stay, the oldest fading.',
 'Pinch the top thread to hold it: lift to tighten, lower to feed slack. The thread shows its tension from the discs down, from slack blue to tight red, and the next stitches lock low, even or high; pull too far and it snaps.',
 'X-ray cycles to light painting: each working point (needle, take-up eye, crank pin, hook point, feed dog tooth, loop) leaves its path over the last three turns.',
 'Slice is a high-speed camera too: full speed played 50 times slower, with a live timing diagram of needle, take-up, hook and feed against the crank.',
 'Thumb up runs to 800 stitches a minute under a strobe a hair faster, so the machine seems to creep backwards; thumb down runs backwards and unpicks.',
 'Clap to stop time mid-stitch, with every part labelled; clap again or wait six seconds. Tear apart and it keeps running, with links showing which part drives which.',
];
export const machineNote=`Take a part out, run the object, and see why that part was there. Pull the take-up lever, feed dog or bobbin and the next stitches show what it was doing. Elias Howe patented the lockstitch in 1846: a needle with its eye at the point, and a second thread locked through the loop it leaves. Rival makers built on his work, the patent fights ran for years, and in 1856 the leading patent holders pooled their claims, the first patent pool in America. ${machineModes.join(' ')} What is modelled: the crank drives every part, and the order and timing of a stitch follow the model, including a real catch window for the hook. What is not: the loop’s bow is exaggerated so it can be seen, thread length is not conserved, tension is one number you set by hand rather than a simulation of thread and discs, the strobe and slow motion are rendering tricks on that model, and the geometry is illustrative, with the mechanism far larger than the body around it.`;
export const machineHow='Scale in past the plate for the close-up, or out for the whole machine. Press T to retime the hook, Home or Recenter to put everything back.';
