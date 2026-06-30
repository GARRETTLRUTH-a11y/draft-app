export type CfbTeam = {
  name: string;
  conference: string;
  color: string;
};

// Prestige (0-5 stars, half-star increments) sourced from collegefootball.gg.
// 0 means the program has no stars (all gray on the site).
export const TEAM_PRESTIGE: Record<string, number | null> = {
  // SEC
  Alabama: 5,
  Arkansas: 3,
  Auburn: 4.5,
  Florida: 4.5,
  Georgia: 5,
  Kentucky: 3,
  LSU: 4.5,
  "Mississippi State": 2.5,
  Missouri: 3,
  "Ole Miss": 4.5,
  Oklahoma: 4.5,
  "South Carolina": 3,
  Tennessee: 4,
  Texas: 4.5,
  "Texas A&M": 4.5,
  Vanderbilt: 2,

  // Big Ten
  Illinois: 4.5,
  Indiana: 4.5,
  Iowa: 4.5,
  Maryland: 2.5,
  Michigan: 4.5,
  "Michigan State": 4.5,
  Minnesota: 4.5,
  Nebraska: 4,
  Northwestern: 2.5,
  "Ohio State": 5,
  Oregon: 4.5,
  "Penn State": 4,
  Purdue: 2,
  Rutgers: 2,
  UCLA: 3.5,
  USC: 4.5,
  Washington: 4,
  Wisconsin: 3,

  // Big 12
  Arizona: 2.5,
  "Arizona State": 3,
  Baylor: 2.5,
  BYU: 4,
  Cincinnati: 2.5,
  Colorado: 3,
  Houston: 3,
  "Iowa State": 2.5,
  Kansas: 2.5,
  "Kansas State": 2.5,
  "Oklahoma State": 3.5,
  TCU: 3.5,
  "Texas Tech": 4.5,
  UCF: 2.5,
  Utah: 3.5,
  "West Virginia": 2.5,

  // ACC
  "Boston College": 2.5,
  California: 3,
  Clemson: 4.5,
  Duke: 3,
  "Florida State": 4.5,
  "Georgia Tech": 4.5,
  Louisville: 3,
  Miami: 4.5,
  "NC State": 3,
  "North Carolina": 2.5,
  Pittsburgh: 3,
  SMU: 3,
  Stanford: 3,
  Syracuse: 3,
  Virginia: 3,
  "Virginia Tech": 3,
  "Wake Forest": 2,

  // Pac-12
  "Oregon State": 2,
  "Washington State": 2,
  "Boise State": 2.5,
  "Colorado State": 1.5,
  "Fresno State": 1.5,
  "San Diego State": 1,
  UNLV: 1.5,
  "Utah State": 1.5,

  // American
  Army: 2.5,
  Charlotte: 0.5,
  "East Carolina": 2,
  "Florida Atlantic": 1,
  Memphis: 2,
  Navy: 2.5,
  "North Texas": 1.5,
  Rice: 1.5,
  "South Florida": 1.5,
  Temple: 1,
  Tulane: 2.5,
  Tulsa: 1.5,
  UAB: 1,
  UTSA: 1.5,

  // Mountain West
  "Air Force": 1,
  Hawaii: 1.5,
  Nevada: 1,
  "New Mexico": 1,
  "San Jose State": 2,
  Wyoming: 1,

  // Conference USA
  Delaware: 1,
  FIU: 1,
  "Jacksonville State": 1,
  "Kennesaw State": 1,
  Liberty: 1,
  "Louisiana Tech": 1,
  "Middle Tennessee": 0.5,
  "Missouri State": 0.5,
  "New Mexico State": 1,
  "Sam Houston": 0.5,
  UTEP: 0.5,
  "Western Kentucky": 1.5,

  // MAC
  Akron: 0,
  "Ball State": 0.5,
  "Bowling Green": 0.5,
  Buffalo: 0,
  "Central Michigan": 1,
  "Eastern Michigan": 0.5,
  "Kent State": 0,
  Massachusetts: 0.5,
  "Miami (OH)": 1,
  "Northern Illinois": 1,
  Ohio: 1,
  Toledo: 1,
  "Western Michigan": 1,

  // Sun Belt
  "Appalachian State": 1,
  "Arkansas State": 0.5,
  "Coastal Carolina": 1,
  "Georgia Southern": 1.5,
  "Georgia State": 0,
  "James Madison": 1.5,
  Louisiana: 1,
  "Louisiana-Monroe": 0.5,
  Marshall: 1,
  "Old Dominion": 1,
  "South Alabama": 0.5,
  "Southern Miss": 0.5,
  "Texas State": 1,
  Troy: 1,

  // FBS Independents
  "Notre Dame": 4.5,
  UConn: 1.5,
};

export const CONFERENCE_ORDER = [
  "SEC",
  "Big Ten",
  "Big 12",
  "ACC",
  "Pac-12",
  "American",
  "Mountain West",
  "Conference USA",
  "MAC",
  "Sun Belt",
  "FBS Independents",
];

export const CONFERENCE_TIERS: Record<string, string> = {
  SEC: "Power Conferences",
  "Big Ten": "Power Conferences",
  "Big 12": "Power Conferences",
  ACC: "Power Conferences",
  "Pac-12": "Power Conferences",
  American: "Group of Five",
  "Mountain West": "Group of Five",
  "Conference USA": "Group of Five",
  MAC: "Group of Five",
  "Sun Belt": "Group of Five",
  "FBS Independents": "Independents",
};

export const TIER_ORDER = ["Power Conferences", "Group of Five", "Independents"];

export const CFB_TEAMS: CfbTeam[] = [
  // SEC
  { name: "Alabama", conference: "SEC", color: "#9E1B32" },
  { name: "Arkansas", conference: "SEC", color: "#9D2235" },
  { name: "Auburn", conference: "SEC", color: "#03244D" },
  { name: "Florida", conference: "SEC", color: "#0021A5" },
  { name: "Georgia", conference: "SEC", color: "#BA0C2F" },
  { name: "Kentucky", conference: "SEC", color: "#0033A0" },
  { name: "LSU", conference: "SEC", color: "#461D7C" },
  { name: "Mississippi State", conference: "SEC", color: "#660000" },
  { name: "Missouri", conference: "SEC", color: "#000000" },
  { name: "Ole Miss", conference: "SEC", color: "#14213D" },
  { name: "Oklahoma", conference: "SEC", color: "#841617" },
  { name: "South Carolina", conference: "SEC", color: "#73000A" },
  { name: "Tennessee", conference: "SEC", color: "#FF8200" },
  { name: "Texas", conference: "SEC", color: "#BF5700" },
  { name: "Texas A&M", conference: "SEC", color: "#500000" },
  { name: "Vanderbilt", conference: "SEC", color: "#000000" },

  // Big Ten
  { name: "Illinois", conference: "Big Ten", color: "#E84A27" },
  { name: "Indiana", conference: "Big Ten", color: "#990000" },
  { name: "Iowa", conference: "Big Ten", color: "#000000" },
  { name: "Maryland", conference: "Big Ten", color: "#E03A3E" },
  { name: "Michigan", conference: "Big Ten", color: "#00274C" },
  { name: "Michigan State", conference: "Big Ten", color: "#18453B" },
  { name: "Minnesota", conference: "Big Ten", color: "#7A0019" },
  { name: "Nebraska", conference: "Big Ten", color: "#E41C38" },
  { name: "Northwestern", conference: "Big Ten", color: "#4E2A84" },
  { name: "Ohio State", conference: "Big Ten", color: "#BB0000" },
  { name: "Oregon", conference: "Big Ten", color: "#154733" },
  { name: "Penn State", conference: "Big Ten", color: "#041E42" },
  { name: "Purdue", conference: "Big Ten", color: "#CFB991" },
  { name: "Rutgers", conference: "Big Ten", color: "#CC0033" },
  { name: "UCLA", conference: "Big Ten", color: "#2774AE" },
  { name: "USC", conference: "Big Ten", color: "#990000" },
  { name: "Washington", conference: "Big Ten", color: "#4B2E83" },
  { name: "Wisconsin", conference: "Big Ten", color: "#C5050C" },

  // Big 12
  { name: "Arizona", conference: "Big 12", color: "#AB0520" },
  { name: "Arizona State", conference: "Big 12", color: "#8C1D40" },
  { name: "Baylor", conference: "Big 12", color: "#154734" },
  { name: "BYU", conference: "Big 12", color: "#002E5D" },
  { name: "Cincinnati", conference: "Big 12", color: "#E00122" },
  { name: "Colorado", conference: "Big 12", color: "#000000" },
  { name: "Houston", conference: "Big 12", color: "#C8102E" },
  { name: "Iowa State", conference: "Big 12", color: "#C8102E" },
  { name: "Kansas", conference: "Big 12", color: "#0051BA" },
  { name: "Kansas State", conference: "Big 12", color: "#512888" },
  { name: "Oklahoma State", conference: "Big 12", color: "#FF7300" },
  { name: "TCU", conference: "Big 12", color: "#4D1979" },
  { name: "Texas Tech", conference: "Big 12", color: "#CC0000" },
  { name: "UCF", conference: "Big 12", color: "#000000" },
  { name: "Utah", conference: "Big 12", color: "#CC0000" },
  { name: "West Virginia", conference: "Big 12", color: "#002855" },

  // ACC
  { name: "Boston College", conference: "ACC", color: "#8C2232" },
  { name: "California", conference: "ACC", color: "#003262" },
  { name: "Clemson", conference: "ACC", color: "#F66733" },
  { name: "Duke", conference: "ACC", color: "#00539B" },
  { name: "Florida State", conference: "ACC", color: "#782F40" },
  { name: "Georgia Tech", conference: "ACC", color: "#003057" },
  { name: "Louisville", conference: "ACC", color: "#AD0000" },
  { name: "Miami", conference: "ACC", color: "#005030" },
  { name: "NC State", conference: "ACC", color: "#CC0000" },
  { name: "North Carolina", conference: "ACC", color: "#4B9CD3" },
  { name: "Pittsburgh", conference: "ACC", color: "#003594" },
  { name: "SMU", conference: "ACC", color: "#C8102E" },
  { name: "Stanford", conference: "ACC", color: "#8C1515" },
  { name: "Syracuse", conference: "ACC", color: "#D44500" },
  { name: "Virginia", conference: "ACC", color: "#232D4B" },
  { name: "Virginia Tech", conference: "ACC", color: "#630031" },
  { name: "Wake Forest", conference: "ACC", color: "#9E7E38" },

  // Pac-12
  { name: "Oregon State", conference: "Pac-12", color: "#DC4405" },
  { name: "Washington State", conference: "Pac-12", color: "#981E32" },
  { name: "Boise State", conference: "Pac-12", color: "#0033A0" },
  { name: "Colorado State", conference: "Pac-12", color: "#1E4D2B" },
  { name: "Fresno State", conference: "Pac-12", color: "#DB0032" },
  { name: "San Diego State", conference: "Pac-12", color: "#A6192E" },
  { name: "UNLV", conference: "Pac-12", color: "#CF0A2C" },
  { name: "Utah State", conference: "Pac-12", color: "#0F2439" },

  // American (AAC)
  { name: "Army", conference: "American", color: "#000000" },
  { name: "Charlotte", conference: "American", color: "#046A38" },
  { name: "East Carolina", conference: "American", color: "#592A8A" },
  { name: "Florida Atlantic", conference: "American", color: "#003366" },
  { name: "Memphis", conference: "American", color: "#003087" },
  { name: "Navy", conference: "American", color: "#00205B" },
  { name: "North Texas", conference: "American", color: "#00853E" },
  { name: "Rice", conference: "American", color: "#00205B" },
  { name: "South Florida", conference: "American", color: "#006747" },
  { name: "Temple", conference: "American", color: "#9D2235" },
  { name: "Tulane", conference: "American", color: "#006747" },
  { name: "Tulsa", conference: "American", color: "#002D72" },
  { name: "UAB", conference: "American", color: "#1E6B52" },
  { name: "UTSA", conference: "American", color: "#0C2340" },

  // Mountain West
  { name: "Air Force", conference: "Mountain West", color: "#003087" },
  { name: "Hawaii", conference: "Mountain West", color: "#024731" },
  { name: "Nevada", conference: "Mountain West", color: "#003366" },
  { name: "New Mexico", conference: "Mountain West", color: "#BA0C2F" },
  { name: "San Jose State", conference: "Mountain West", color: "#0055A2" },
  { name: "Wyoming", conference: "Mountain West", color: "#492F24" },

  // Conference USA
  { name: "Delaware", conference: "Conference USA", color: "#00539F" },
  { name: "FIU", conference: "Conference USA", color: "#081E3F" },
  { name: "Jacksonville State", conference: "Conference USA", color: "#BA0C2F" },
  { name: "Kennesaw State", conference: "Conference USA", color: "#000000" },
  { name: "Liberty", conference: "Conference USA", color: "#C8102E" },
  { name: "Louisiana Tech", conference: "Conference USA", color: "#C41230" },
  { name: "Middle Tennessee", conference: "Conference USA", color: "#0066CC" },
  { name: "Missouri State", conference: "Conference USA", color: "#6F263D" },
  { name: "New Mexico State", conference: "Conference USA", color: "#8C2434" },
  { name: "Sam Houston", conference: "Conference USA", color: "#F66733" },
  { name: "UTEP", conference: "Conference USA", color: "#041E42" },
  { name: "Western Kentucky", conference: "Conference USA", color: "#C8102E" },

  // MAC
  { name: "Akron", conference: "MAC", color: "#041E42" },
  { name: "Ball State", conference: "MAC", color: "#BA0C2F" },
  { name: "Bowling Green", conference: "MAC", color: "#FE5000" },
  { name: "Buffalo", conference: "MAC", color: "#005BBB" },
  { name: "Central Michigan", conference: "MAC", color: "#6A0032" },
  { name: "Eastern Michigan", conference: "MAC", color: "#006633" },
  { name: "Kent State", conference: "MAC", color: "#002664" },
  { name: "Massachusetts", conference: "MAC", color: "#881C1C" },
  { name: "Miami (OH)", conference: "MAC", color: "#C41230" },
  { name: "Northern Illinois", conference: "MAC", color: "#C8102E" },
  { name: "Ohio", conference: "MAC", color: "#00694E" },
  { name: "Toledo", conference: "MAC", color: "#003E7E" },
  { name: "Western Michigan", conference: "MAC", color: "#532E1F" },

  // Sun Belt
  { name: "Appalachian State", conference: "Sun Belt", color: "#000000" },
  { name: "Arkansas State", conference: "Sun Belt", color: "#CC092F" },
  { name: "Coastal Carolina", conference: "Sun Belt", color: "#006666" },
  { name: "Georgia Southern", conference: "Sun Belt", color: "#00224E" },
  { name: "Georgia State", conference: "Sun Belt", color: "#0039A6" },
  { name: "James Madison", conference: "Sun Belt", color: "#450084" },
  { name: "Louisiana", conference: "Sun Belt", color: "#CE181E" },
  { name: "Louisiana-Monroe", conference: "Sun Belt", color: "#8B2331" },
  { name: "Marshall", conference: "Sun Belt", color: "#00B140" },
  { name: "Old Dominion", conference: "Sun Belt", color: "#003057" },
  { name: "South Alabama", conference: "Sun Belt", color: "#00205B" },
  { name: "Southern Miss", conference: "Sun Belt", color: "#FFC72C" },
  { name: "Texas State", conference: "Sun Belt", color: "#501214" },
  { name: "Troy", conference: "Sun Belt", color: "#8A1F2D" },

  // FBS Independents
  { name: "Notre Dame", conference: "FBS Independents", color: "#0C2340" },
  { name: "UConn", conference: "FBS Independents", color: "#000E2F" },
];

export type CfbDraftItem = {
  id: number;
  name: string;
  category: string;
  description: string;
  color?: string;
  prestige?: number | null;
};

export const CFB_ITEMS: CfbDraftItem[] = CFB_TEAMS.map((team, index) => ({
  id: index + 1,
  name: team.name,
  category: team.conference,
  description: `${team.conference} program.`,
  color: team.color,
  prestige: TEAM_PRESTIGE[team.name] ?? null,
}));
