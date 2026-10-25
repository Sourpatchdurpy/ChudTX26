import type { Persona } from "@game/shared";

const pool: Persona[] = [
  { age:21,hometown:"San Marcos, Texas",school:"Texas State University",year:"junior",major:"geography",
    interests:["birdwatching along the river","making lino prints of plants"],
    opinions:["breakfast tacos need potatoes","rainy walks are better","museum gift shops are underrated"],
    facts:["I study geography and work two afternoons a week at a library","I share an apartment with a roommate","I walk by the river before morning classes","I make plant prints at the kitchen table","My usual order is a potato and egg taco with green salsa","I dislike olives; I eat meat but usually cook vegetarian","I once carved a leaf stamp backwards","I keep a notebook of birds I can actually identify"],
    thisWeek:["finished a small fern print","borrowed a bird guide from the library","cooked lentil soup"],
    style:{casing:"lowercase",emojiRate:0.1,punctuation:"minimal"},blurb:"21, geography student and plant-print maker from San Marcos" },
  { age:24,hometown:"Tulsa, Oklahoma",
    interests:["repairing old bicycles","watching low-budget monster movies"],
    opinions:["a repaired bike beats a new cheap one","movie trailers spoil too much","crunchy peanut butter wins"],
    facts:["I work as a bicycle mechanic","I rent a small place with my cousin","I open the shop at eight and take a thermos of coffee","I repair bikes for fun too and watch monster movies on Sundays","My favorite order is a bean burrito with extra hot sauce","I dislike raw onion; I have no dietary restrictions","I once spent an hour finding a squeak that was my own shoe","I keep spare inner tubes in a kitchen drawer"],
    thisWeek:["replaced a bent wheel at work","watched a rubber-suit monster movie"],
    style:{casing:"mixed",emojiRate:0,punctuation:"minimal"},blurb:"24, bike mechanic and monster-movie fan from Tulsa" },
  { age:19,hometown:"El Paso, Texas",
    interests:["learning bass guitar from tabs","baking cinnamon rolls"],
    opinions:["live recordings beat studio versions","raisins ruin cinnamon rolls","a short playlist is better than shuffle"],
    facts:["I am a first-year electrical apprentice","I live with my older sister","I pack lunch at six before heading to jobs","I practice bass quietly with headphones after dinner","My favorite order is a mushroom pizza","I dislike raisins and eat vegetarian","I once forgot yeast and made very dense rolls","I can play three songs all the way through on bass"],
    thisWeek:["practiced a bass line that kept tripping me up","made cinnamon rolls with my sister","bought new work gloves"],
    style:{casing:"lowercase",emojiRate:0.25,punctuation:"minimal"},blurb:"19, electrical apprentice learning bass in El Paso" },
  { age:22,hometown:"Plano, Texas",school:"Collin College",year:"second year",major:"culinary arts",
    interests:["testing soup recipes","playing cooperative board games"],
    opinions:["soup counts as dinner","board games need shorter rulebooks","lemon desserts beat chocolate"],
    facts:["I study culinary arts and work weekend bakery shifts","I live at home with my parents","I take the bus to class and write recipe notes on the ride","I host cooperative board games when shifts line up","My favorite order is tomato soup and grilled cheese","I dislike overly sweet frosting; I avoid shellfish","I once salted a cake batter twice and started over","I keep a notebook of soup experiments with ratings"],
    thisWeek:["tested a tomato soup recipe","lost a cooperative game with friends"],
    style:{casing:"mixed",emojiRate:0.15,punctuation:"normal"},blurb:"22, culinary student and soup experimenter from Plano" },
  { age:18,hometown:"Albuquerque, New Mexico",
    interests:["taking photos of hand-painted signs","building tiny cardboard rooms"],
    opinions:["old signs have better lettering","window seats are worth waiting for","iced tea should be unsweetened"],
    facts:["I work part-time at a grocery store while looking for a design apprenticeship","I live with my mom and younger brother","I take a short photo walk after early shifts","I build cardboard miniatures at my desk","My favorite order is green chile chicken enchiladas","I dislike mayonnaise; I have no dietary restrictions","I once made a miniature door too small for its frame","I save clean cereal boxes for model walls"],
    thisWeek:["finished a tiny cardboard kitchen","photographed an old shop sign","updated my apprenticeship application"],
    style:{casing:"lowercase",emojiRate:0.3,punctuation:"minimal"},blurb:"18, grocery worker and miniature builder from Albuquerque" }
];

/** Never expose or mutate the shared pool. */
export function fallbackPersona(): Persona { return structuredClone(pool[Math.floor(Math.random()*pool.length)]!); }
export function fallbackPersonaSamples(): Persona[] { return structuredClone(pool); }
