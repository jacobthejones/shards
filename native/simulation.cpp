#include <stdint.h>

// This is a freestanding, C-compatible C++ implementation of the full simulation.
// It intentionally keeps the same data-oriented layout as the C version.

#define GRID_MIN (-50)
#define GRID_MAX 50
#define GRID_SIZE 101
#define GRID_CELLS (GRID_SIZE * GRID_SIZE)
#define MAX_SHARDS 10000
#define MAX_CELL_POINTS 64
#define FIELD_SITE_SELECTION_RADIUS 46.0
#define FIELD_SITE_GENERATION_RADIUS 68.0
#define FIELD_CLIP_BOUNDARY_POINT_COUNT 64
#define FIELD_CLIP_BOUNDARY_RADIUS 80.0
#define MAX_FIELD_BOUNDARY_POINTS 2048
#define MAX_FIELD_LAYOUT_ATTEMPTS 48
#define MAX_IMPACTS 64
#define MAX_BALLS 256
#define MAX_SEEDS 16384
#define MAX_EVENTS_PER_STEP 1024
#define MAX_CORROSIVE_WAKE_SEGMENTS 512

#define CELL_SIZE 1.0
#define TAU 6.283185307179586476925286766559
#define BASE_BALL_RADIUS 0.095
#define INITIAL_BALL_SPEED 1.4366976021418008
#define SHARD_MAX_HEALTH 1.0
#define BASE_HIT_DAMAGE 0.2
#define SHARD_REGENERATION_RATE 0.01
#define SHARD_GROWTH_INITIAL 0.50
#define SHARD_GROWTH_RATE 0.01
#define HEALTH_EPSILON 0.000000001
#define INITIAL_BALL_COST 300.0
#define BALL_COST_GROWTH 1.2
#define RESONANCE_COST 10000.0
#define GERMINATION_COST 5000.0
#define CONDUCTION_COST 50000.0
#define CHOSEN_ONE_COST 10000.0
#define CORROSIVE_WAKE_COST 50000.0
#define CORROSIVE_WAKE_DURATION_SECONDS 6.0
#define CORROSIVE_WAKE_RADIUS 0.15
#define RESONANCE_SPLASH_DAMAGE 0.1
#define CONDUCTION_SPLASH_DAMAGE 0.05
#define CHOSEN_ONE_DAMAGE_MULTIPLIER 5.0
#define CHOSEN_BALL_INDEX 0
#define SIMULATION_RUNTIME_VERSION 17
#define SEED_SPAWN_MEAN_SECONDS 300.0
#define SEED_GROWTH_RATE 0.01
#define SEED_CHARGE_RATE 0.01
#define SEED_LUMENS 10.0
#define BOUNCE_JITTER_RADIANS (0.02 * 3.1415926535897932384626433832795 / 180.0)
#define COLLISION_SEPARATION 0.004
#define KINETIC_ENERGY_TOLERANCE 0.000000000001
#define MAX_COLLISIONS_PER_STEP 4
#define MAX_TOUCHING_SHARDS 64
#define MAX_SECOND_NEIGHBORS 128
#define FIXED_TIMESTEP (1.0 / 60.0)
#define RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS 60.0

extern "C" {
extern double sin(double);
extern double cos(double);
extern double sqrt(double);
extern double exp(double);
extern double log(double);
extern double floor(double);
extern double ceil(double);
}

static double POINT_X[MAX_SHARDS * MAX_CELL_POINTS];
static double POINT_Y[MAX_SHARDS * MAX_CELL_POINTS];
static int32_t POINT_COUNT[MAX_SHARDS];
static double FIELD_BOUNDARY_X[MAX_FIELD_BOUNDARY_POINTS];
static double FIELD_BOUNDARY_Y[MAX_FIELD_BOUNDARY_POINTS];
static int32_t field_boundary_point_count;
static double FIELD_CLIP_BOUNDARY_X[FIELD_CLIP_BOUNDARY_POINT_COUNT];
static double FIELD_CLIP_BOUNDARY_Y[FIELD_CLIP_BOUNDARY_POINT_COUNT];
static int32_t FIELD_SITE_SELECTED[GRID_CELLS];
static double CENTER_X[MAX_SHARDS];
static double CENTER_Y[MAX_SHARDS];
static int32_t GRID[GRID_CELLS];
static int32_t SHARD_GX[MAX_SHARDS];
static int32_t SHARD_GY[MAX_SHARDS];
static double SHARD_SX[MAX_SHARDS];
static double SHARD_SY[MAX_SHARDS];
static double SHARD_HEALTH[MAX_SHARDS];
static double SHARD_HEALTH_UPDATED_AT[MAX_SHARDS];
static double SHARD_GROWTH[MAX_SHARDS];
static int32_t SHARD_GROWING[MAX_SHARDS];
static int32_t SHARD_GROWTH_PENDING[MAX_SHARDS];
static double SHARD_HUE[MAX_SHARDS];
static double SHARD_SEED[MAX_SHARDS];
static int32_t SHARD_BROKEN[MAX_SHARDS];
static int32_t SHARD_BOUNDARY_EDGE[MAX_SHARDS * MAX_CELL_POINTS];
static int32_t SHARD_HAS_BOUNDARY_EDGE[MAX_SHARDS];
static int32_t BOUNDARY_EDGE_SHARD[MAX_FIELD_BOUNDARY_POINTS];
static int32_t BOUNDARY_EDGE_INDEX[MAX_FIELD_BOUNDARY_POINTS];
static int32_t SHARD_IMPACT_COUNT[MAX_SHARDS];
static double SHARD_IMPACT_STRENGTH[MAX_SHARDS * MAX_IMPACTS];
static double SHARD_IMPACT_X[MAX_SHARDS * MAX_IMPACTS];
static double SHARD_IMPACT_Y[MAX_SHARDS * MAX_IMPACTS];
static double SHARD_IMPACT_INWARD_X[MAX_SHARDS * MAX_IMPACTS];
static double SHARD_IMPACT_INWARD_Y[MAX_SHARDS * MAX_IMPACTS];
static int32_t SHARD_IMPACT_ID[MAX_SHARDS * MAX_IMPACTS];
static int32_t SHARD_DAMAGED[MAX_SHARDS];
static int32_t DAMAGED_SHARDS[MAX_SHARDS];
static int32_t damaged_shard_count;

static double BALL_X[MAX_BALLS];
static double BALL_Y[MAX_BALLS];
static double BALL_VX[MAX_BALLS];
static double BALL_VY[MAX_BALLS];
static double BALL_HIT_COOLDOWN[MAX_BALLS];
static int32_t BALL_CORROSIVE_WAKE_CHARGED[MAX_BALLS];
static double BALL_NEXT_SEED_AT[MAX_BALLS];

static int32_t SEED_SHARD[MAX_SEEDS];
static double SEED_GROWTH[MAX_SEEDS];
static double SEED_CHARGE[MAX_SEEDS];
static int32_t seed_count;

static double CORROSIVE_WAKE_START_X[MAX_CORROSIVE_WAKE_SEGMENTS];
static double CORROSIVE_WAKE_START_Y[MAX_CORROSIVE_WAKE_SEGMENTS];
static double CORROSIVE_WAKE_END_X[MAX_CORROSIVE_WAKE_SEGMENTS];
static double CORROSIVE_WAKE_END_Y[MAX_CORROSIVE_WAKE_SEGMENTS];
static double CORROSIVE_WAKE_AGE[MAX_CORROSIVE_WAKE_SEGMENTS];
static int32_t corrosive_wake_segment_count;

static int32_t shard_count;
static int32_t ball_count;
static int32_t total_hits;
static int32_t total_breaks;
static double score;
static double recent_break_rate;
static double simulation_time;
static uint32_t rng_state;
static double current_field_seed;
static int32_t next_impact_id;
static int32_t chosen_one_unlocked;
static int32_t corrosive_wake_unlocked;
// Legacy New Growth state is retained with its implementation below for a
// future repurpose. It is no longer part of the active tech tree.
static int32_t new_growth_unlocked;
static int32_t resonance_unlocked;
static int32_t conduction_unlocked;
static int32_t germination_unlocked;
static int32_t field_layout_variant;
static int32_t event_count;
static int32_t event_type[MAX_EVENTS_PER_STEP];
static int32_t event_shard[MAX_EVENTS_PER_STEP];
static int32_t event_source_shard[MAX_EVENTS_PER_STEP];
static double last_score;
static int32_t last_hits;
static int32_t last_breaks;
static int32_t last_shards;
static double last_checksum;

static const double HEXAGON_X[6] = {1.0, 0.5, -0.5, -1.0, -0.5, 0.5};
static const double HEXAGON_Y[6] = {0.0, 0.8660254037844386, 0.8660254037844386, 0.0, -0.8660254037844386, -0.8660254037844386};

static int32_t grid_index(int32_t gx, int32_t gy) {
  return (gy - GRID_MIN) * GRID_SIZE + (gx - GRID_MIN);
}

static int32_t in_grid(int32_t gx, int32_t gy) {
  return gx >= GRID_MIN && gx <= GRID_MAX && gy >= GRID_MIN && gy <= GRID_MAX;
}

static double hash_value(double gx, double gy) {
  double value = sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
  return value - floor(value);
}

static double seeded_hash(double gx, double gy, double field_seed) {
  return hash_value(gx + field_seed * 17.13, gy - field_seed * 9.71);
}

static int32_t field_site_included(int32_t gx, int32_t gy) {
  return sqrt((double)gx * gx + (double)gy * gy) <= FIELD_SITE_SELECTION_RADIUS
    && FIELD_SITE_SELECTED[grid_index(gx, gy)];
}

static int32_t field_site_available(int32_t gx, int32_t gy) {
  return sqrt((double)gx * gx + (double)gy * gy) <= FIELD_SITE_GENERATION_RADIUS;
}

static void build_field_clip_boundary(double field_seed) {
  for (int32_t index = 0; index < FIELD_CLIP_BOUNDARY_POINT_COUNT; index += 1) {
    double angle = TAU * (double)index / (double)FIELD_CLIP_BOUNDARY_POINT_COUNT;
    double radius = FIELD_CLIP_BOUNDARY_RADIUS
      + (seeded_hash((double)index + 90.1, (double)index - 33.2, field_seed) * 2.0 - 1.0) * 0.18;
    FIELD_CLIP_BOUNDARY_X[index] = cos(angle) * radius;
    FIELD_CLIP_BOUNDARY_Y[index] = sin(angle) * radius;
  }
}

static double rng_next(void) {
  rng_state = rng_state * 1664525u + 1013904223u;
  return (double)rng_state / 4294967296.0;
}

static double next_seed_interval(void) {
  double sample = rng_next();
  if (sample < 0.000000001) sample = 0.000000001;
  return -log(sample) * SEED_SPAWN_MEAN_SECONDS;
}

static void schedule_seed_timers(void) {
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    BALL_NEXT_SEED_AT[ball] = simulation_time + next_seed_interval();
  }
}

static int32_t nearest_broken_shard_for_point(double x, double y) {
  int32_t base_gx = (int32_t)floor(x + 0.5);
  int32_t base_gy = (int32_t)floor(y + 0.5);
  int32_t nearest = -1;
  double nearest_distance = 1.7976931348623157e+308;
  for (int32_t gy = base_gy - 5; gy <= base_gy + 5; gy += 1) {
    for (int32_t gx = base_gx - 5; gx <= base_gx + 5; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t shard = GRID[grid_index(gx, gy)];
      if (shard < 0 || !SHARD_BROKEN[shard]) continue;
      double dx = CENTER_X[shard] - x;
      double dy = CENTER_Y[shard] - y;
      double distance = dx * dx + dy * dy;
      if (distance >= nearest_distance) continue;
      nearest_distance = distance;
      nearest = shard;
    }
  }
  return nearest;
}

static void site_for(int32_t gx, int32_t gy, double field_seed, double *x, double *y) {
  if (gx == 0 && gy == 0) {
    *x = 0.0;
    *y = 0.0;
    return;
  }
  double layout_seed = field_seed + (double)field_layout_variant * 971.37;
  double angle = seeded_hash((double)gx + 18.4, (double)gy - 7.1, layout_seed) * TAU;
  double grid_radius = sqrt((double)gx * gx + (double)gy * gy);
  double displacement_scale = grid_radius > FIELD_SITE_SELECTION_RADIUS - 3.0 ? 0.30 : 0.78;
  double radius = sqrt(seeded_hash((double)gx - 4.2, (double)gy + 21.8, layout_seed)) * displacement_scale;
  double organic_scale = grid_radius > FIELD_SITE_SELECTION_RADIUS - 3.0 ? 0.03 : 0.075;
  *x = gx * CELL_SIZE + cos(angle) * radius + sin(gx * 0.71 + gy * 1.17) * organic_scale;
  *y = gy * CELL_SIZE + sin(angle) * radius + cos(gx * 1.09 - gy * 0.53) * organic_scale;
}

static int32_t clip_polygon(
  const double *input_x,
  const double *input_y,
  int32_t input_count,
  double a,
  double b,
  double c,
  double *output_x,
  double *output_y
) {
  int32_t output_count = 0;
  for (int32_t index = 0; index < input_count; index += 1) {
    int32_t next = (index + 1) % input_count;
    double current_x = input_x[index];
    double current_y = input_y[index];
    double next_x = input_x[next];
    double next_y = input_y[next];
    double current_value = a * current_x + b * current_y - c;
    double next_value = a * next_x + b * next_y - c;
    int32_t current_inside = current_value <= 0.0;
    int32_t next_inside = next_value <= 0.0;
    if (current_inside && output_count < MAX_CELL_POINTS) {
      output_x[output_count] = current_x;
      output_y[output_count] = current_y;
      output_count += 1;
    }
    if (current_inside != next_inside && output_count < MAX_CELL_POINTS) {
      double ratio = current_value / (current_value - next_value);
      output_x[output_count] = current_x + (next_x - current_x) * ratio;
      output_y[output_count] = current_y + (next_y - current_y) * ratio;
      output_count += 1;
    }
  }
  return output_count;
}

static int32_t build_cell(int32_t gx, int32_t gy, double field_seed, double *sx, double *sy, double *points_x, double *points_y) {
  site_for(gx, gy, field_seed, sx, sy);
  double polygon_x[MAX_CELL_POINTS];
  double polygon_y[MAX_CELL_POINTS];
  double clipped_x[MAX_CELL_POINTS];
  double clipped_y[MAX_CELL_POINTS];
  int32_t polygon_count = FIELD_CLIP_BOUNDARY_POINT_COUNT;
  for (int32_t index = 0; index < polygon_count; index += 1) {
    polygon_x[index] = FIELD_CLIP_BOUNDARY_X[index];
    polygon_y[index] = FIELD_CLIP_BOUNDARY_Y[index];
  }

  for (int32_t neighbor_y = gy - 4; neighbor_y <= gy + 4; neighbor_y += 1) {
    for (int32_t neighbor_x = gx - 4; neighbor_x <= gx + 4; neighbor_x += 1) {
      if (neighbor_x == gx && neighbor_y == gy) continue;
      if (!field_site_available(neighbor_x, neighbor_y)) continue;
      double nx, ny;
      site_for(neighbor_x, neighbor_y, field_seed, &nx, &ny);
      double a = nx - *sx;
      double b = ny - *sy;
      double c = (nx * nx + ny * ny - *sx * *sx - *sy * *sy) / 2.0;
      polygon_count = clip_polygon(polygon_x, polygon_y, polygon_count, a, b, c, clipped_x, clipped_y);
      for (int32_t index = 0; index < polygon_count; index += 1) {
        polygon_x[index] = clipped_x[index];
        polygon_y[index] = clipped_y[index];
      }
      if (polygon_count < 3) break;
    }
    if (polygon_count < 3) break;
  }

  if (polygon_count < 3) return 0;
  for (int32_t index = 0; index < polygon_count; index += 1) {
    points_x[index] = polygon_x[index];
    points_y[index] = polygon_y[index];
  }
  return polygon_count;
}

static int32_t point_in_polygon(double x, double y, int32_t shard) {
  int32_t inside = 0;
  int32_t count = POINT_COUNT[shard];
  int32_t previous = count - 1;
  int32_t start = shard * MAX_CELL_POINTS;
  for (int32_t index = 0; index < count; previous = index++) {
    double xi = POINT_X[start + index];
    double yi = POINT_Y[start + index];
    double xj = POINT_X[start + previous];
    double yj = POINT_Y[start + previous];
    int32_t intersects = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

static void closest_point_on_segment(double x, double y, double ax, double ay, double bx, double by, double *out_x, double *out_y) {
  double edge_x = bx - ax;
  double edge_y = by - ay;
  double length_squared = edge_x * edge_x + edge_y * edge_y;
  if (length_squared == 0.0) length_squared = 1.0;
  double ratio = ((x - ax) * edge_x + (y - ay) * edge_y) / length_squared;
  if (ratio < 0.0) ratio = 0.0;
  if (ratio > 1.0) ratio = 1.0;
  *out_x = ax + edge_x * ratio;
  *out_y = ay + edge_y * ratio;
}

static int32_t circle_intersects_polygon(double x, double y, double radius, int32_t shard) {
  if (point_in_polygon(x, y, shard)) return 1;
  double radius_squared = radius * radius;
  int32_t count = POINT_COUNT[shard];
  int32_t start = shard * MAX_CELL_POINTS;
  for (int32_t index = 0; index < count; index += 1) {
    double dx = POINT_X[start + index] - x;
    double dy = POINT_Y[start + index] - y;
    if (dx * dx + dy * dy <= radius_squared) return 1;
    int32_t next = (index + 1) % count;
    double closest_x, closest_y;
    closest_point_on_segment(x, y, POINT_X[start + index], POINT_Y[start + index], POINT_X[start + next], POINT_Y[start + next], &closest_x, &closest_y);
    dx = closest_x - x;
    dy = closest_y - y;
    if (dx * dx + dy * dy <= radius_squared) return 1;
  }
  return 0;
}

static double point_segment_distance_squared(double x, double y, double ax, double ay, double bx, double by) {
  double closest_x, closest_y;
  closest_point_on_segment(x, y, ax, ay, bx, by, &closest_x, &closest_y);
  double dx = x - closest_x;
  double dy = y - closest_y;
  return dx * dx + dy * dy;
}

static double orientation(double ax, double ay, double bx, double by, double cx, double cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

static int32_t point_on_segment(double ax, double ay, double bx, double by, double px, double py) {
  double min_x = ax < bx ? ax : bx;
  double max_x = ax > bx ? ax : bx;
  double min_y = ay < by ? ay : by;
  double max_y = ay > by ? ay : by;
  return px >= min_x - 0.000001 && px <= max_x + 0.000001
    && py >= min_y - 0.000001 && py <= max_y + 0.000001;
}

static int32_t segments_intersect(
  double ax, double ay, double bx, double by,
  double cx, double cy, double dx, double dy
) {
  double first = orientation(ax, ay, bx, by, cx, cy);
  double second = orientation(ax, ay, bx, by, dx, dy);
  double third = orientation(cx, cy, dx, dy, ax, ay);
  double fourth = orientation(cx, cy, dx, dy, bx, by);
  int32_t first_opposite = (first > 0.000001 && second < -0.000001) || (first < -0.000001 && second > 0.000001);
  int32_t second_opposite = (third > 0.000001 && fourth < -0.000001) || (third < -0.000001 && fourth > 0.000001);
  if (first_opposite && second_opposite) return 1;
  if (first >= -0.000001 && first <= 0.000001 && point_on_segment(ax, ay, bx, by, cx, cy)) return 1;
  if (second >= -0.000001 && second <= 0.000001 && point_on_segment(ax, ay, bx, by, dx, dy)) return 1;
  if (third >= -0.000001 && third <= 0.000001 && point_on_segment(cx, cy, dx, dy, ax, ay)) return 1;
  if (fourth >= -0.000001 && fourth <= 0.000001 && point_on_segment(cx, cy, dx, dy, bx, by)) return 1;
  return 0;
}

static double segment_distance_squared(
  double ax, double ay, double bx, double by,
  double cx, double cy, double dx, double dy
) {
  if (segments_intersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0.0;
  double distance = point_segment_distance_squared(ax, ay, cx, cy, dx, dy);
  double candidate = point_segment_distance_squared(bx, by, cx, cy, dx, dy);
  if (candidate < distance) distance = candidate;
  candidate = point_segment_distance_squared(cx, cy, ax, ay, bx, by);
  if (candidate < distance) distance = candidate;
  candidate = point_segment_distance_squared(dx, dy, ax, ay, bx, by);
  if (candidate < distance) distance = candidate;
  return distance;
}

static void remove_corrosive_wake_segment(int32_t index) {
  int32_t last = corrosive_wake_segment_count - 1;
  if (index < 0 || index > last) return;
  if (index != last) {
    CORROSIVE_WAKE_START_X[index] = CORROSIVE_WAKE_START_X[last];
    CORROSIVE_WAKE_START_Y[index] = CORROSIVE_WAKE_START_Y[last];
    CORROSIVE_WAKE_END_X[index] = CORROSIVE_WAKE_END_X[last];
    CORROSIVE_WAKE_END_Y[index] = CORROSIVE_WAKE_END_Y[last];
    CORROSIVE_WAKE_AGE[index] = CORROSIVE_WAKE_AGE[last];
  }
  corrosive_wake_segment_count -= 1;
}

static void refresh_corrosive_wake() {
  int32_t index = 0;
  while (index < corrosive_wake_segment_count) {
    CORROSIVE_WAKE_AGE[index] += FIXED_TIMESTEP;
    if (CORROSIVE_WAKE_AGE[index] >= CORROSIVE_WAKE_DURATION_SECONDS) {
      remove_corrosive_wake_segment(index);
      continue;
    }
    index += 1;
  }
}

static void add_corrosive_wake_segment(double start_x, double start_y, double end_x, double end_y) {
  if (!corrosive_wake_unlocked) return;
  double delta_x = end_x - start_x;
  double delta_y = end_y - start_y;
  if (delta_x * delta_x + delta_y * delta_y <= 0.000000000001) return;
  int32_t index = corrosive_wake_segment_count;
  if (index >= MAX_CORROSIVE_WAKE_SEGMENTS) {
    index = 0;
    for (int32_t candidate = 1; candidate < corrosive_wake_segment_count; candidate += 1) {
      if (CORROSIVE_WAKE_AGE[candidate] > CORROSIVE_WAKE_AGE[index]) index = candidate;
    }
  } else {
    corrosive_wake_segment_count += 1;
  }
  CORROSIVE_WAKE_START_X[index] = start_x;
  CORROSIVE_WAKE_START_Y[index] = start_y;
  CORROSIVE_WAKE_END_X[index] = end_x;
  CORROSIVE_WAKE_END_Y[index] = end_y;
  CORROSIVE_WAKE_AGE[index] = 0.0;
}

static void charge_ball_from_corrosive_wake(int32_t ball, double start_x, double start_y, double end_x, double end_y) {
  if (!corrosive_wake_unlocked || ball == CHOSEN_BALL_INDEX || BALL_CORROSIVE_WAKE_CHARGED[ball]) return;
  double radius_squared = CORROSIVE_WAKE_RADIUS * CORROSIVE_WAKE_RADIUS;
  for (int32_t index = 0; index < corrosive_wake_segment_count; index += 1) {
    if (segment_distance_squared(
      start_x, start_y, end_x, end_y,
      CORROSIVE_WAKE_START_X[index], CORROSIVE_WAKE_START_Y[index],
      CORROSIVE_WAKE_END_X[index], CORROSIVE_WAKE_END_Y[index]
    ) <= radius_squared) {
      BALL_CORROSIVE_WAKE_CHARGED[ball] = 1;
      return;
    }
  }
}

static int32_t segment_intersects_polygon(
  double x, double y, double next_x, double next_y, double radius, int32_t shard
) {
  if (point_in_polygon(x, y, shard) || point_in_polygon(next_x, next_y, shard)) return 1;
  double radius_squared = radius * radius;
  int32_t count = POINT_COUNT[shard];
  int32_t start = shard * MAX_CELL_POINTS;
  for (int32_t index = 0; index < count; index += 1) {
    int32_t next = (index + 1) % count;
    if (segment_distance_squared(
      x, y, next_x, next_y,
      POINT_X[start + index], POINT_Y[start + index],
      POINT_X[start + next], POINT_Y[start + next]
    ) <= radius_squared) return 1;
  }
  return 0;
}

static int32_t seed_index_for_shard(int32_t shard) {
  for (int32_t index = 0; index < seed_count; index += 1) {
    if (SEED_SHARD[index] == shard) return index;
  }
  return -1;
}

static void clear_seeds(void) {
  seed_count = 0;
}

static int32_t add_seed(int32_t shard) {
  if (shard < 0 || shard >= shard_count || !SHARD_BROKEN[shard] || seed_index_for_shard(shard) >= 0) return 0;
  if (seed_count >= MAX_SEEDS) return 0;
  SEED_SHARD[seed_count] = shard;
  SEED_GROWTH[seed_count] = 0.0;
  SEED_CHARGE[seed_count] = 0.0;
  seed_count += 1;
  return 1;
}

static void refresh_seeds(void) {
  for (int32_t seed = 0; seed < seed_count; seed += 1) {
    if (SEED_GROWTH[seed] < 1.0) {
      SEED_GROWTH[seed] += SEED_GROWTH_RATE * FIXED_TIMESTEP;
      if (SEED_GROWTH[seed] > 1.0) SEED_GROWTH[seed] = 1.0;
      continue;
    }
    SEED_CHARGE[seed] += SEED_CHARGE_RATE * FIXED_TIMESTEP;
    if (SEED_CHARGE[seed] > 1.0) SEED_CHARGE[seed] = 1.0;
  }
}

static void collect_seeds_on_segment(double x, double y, double next_x, double next_y) {
  if (!germination_unlocked || seed_count == 0) return;
  for (int32_t seed = 0; seed < seed_count; seed += 1) {
    if (SEED_CHARGE[seed] < 1.0) continue;
    if (!segment_intersects_polygon(x, y, next_x, next_y, BASE_BALL_RADIUS, SEED_SHARD[seed])) continue;
    score += SEED_LUMENS;
    SEED_CHARGE[seed] = 0.0;
  }
}

static void spawn_seeds_due(void) {
  if (!germination_unlocked) return;
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    if (BALL_NEXT_SEED_AT[ball] <= 0.0) BALL_NEXT_SEED_AT[ball] = simulation_time + next_seed_interval();
    while (simulation_time >= BALL_NEXT_SEED_AT[ball]) {
      add_seed(nearest_broken_shard_for_point(BALL_X[ball], BALL_Y[ball]));
      BALL_NEXT_SEED_AT[ball] += next_seed_interval();
    }
  }
}

static void mark_shard_damaged(int32_t shard) {
  if (SHARD_DAMAGED[shard]) return;
  SHARD_DAMAGED[shard] = 1;
  DAMAGED_SHARDS[damaged_shard_count++] = shard;
}

static void record_event(int32_t type, int32_t shard, int32_t source_shard) {
  if (event_count >= MAX_EVENTS_PER_STEP) return;
  event_type[event_count] = type;
  event_shard[event_count] = shard;
  event_source_shard[event_count] = source_shard;
  event_count += 1;
}

static void add_impact(int32_t shard, double x, double y, double inward_x, double inward_y, double strength) {
  int32_t count = SHARD_IMPACT_COUNT[shard];
  int32_t start = shard * MAX_IMPACTS;
  mark_shard_damaged(shard);
  if (count < MAX_IMPACTS) {
    SHARD_IMPACT_ID[start + count] = next_impact_id++;
    SHARD_IMPACT_X[start + count] = x;
    SHARD_IMPACT_Y[start + count] = y;
    SHARD_IMPACT_INWARD_X[start + count] = inward_x;
    SHARD_IMPACT_INWARD_Y[start + count] = inward_y;
    SHARD_IMPACT_STRENGTH[start + count] = strength;
    SHARD_IMPACT_COUNT[shard] = count + 1;
  } else {
    SHARD_IMPACT_STRENGTH[start + MAX_IMPACTS - 1] += strength;
  }
}

static void begin_shard_growth(int32_t shard) {
  if (!SHARD_BROKEN[shard] || SHARD_GROWING[shard]) return;
  SHARD_GROWTH[shard] = SHARD_GROWTH_INITIAL;
  SHARD_GROWING[shard] = 1;
  SHARD_GROWTH_PENDING[shard] = 0;
  mark_shard_damaged(shard);
  record_event(5, shard, shard);
}

static void reset_shard_growth(int32_t shard) {
  if (!SHARD_GROWING[shard]) return;
  SHARD_GROWTH[shard] = 0.0;
  SHARD_GROWING[shard] = 0;
  SHARD_GROWTH_PENDING[shard] = 0;
  mark_shard_damaged(shard);
  record_event(6, shard, shard);
}

static void refresh_shard_growth(int32_t shard) {
  if (!SHARD_GROWING[shard]) return;
  SHARD_GROWTH[shard] += SHARD_GROWTH_RATE * FIXED_TIMESTEP;
  if (SHARD_GROWTH[shard] < 1.0) return;
  SHARD_GROWTH[shard] = 0.0;
  SHARD_GROWING[shard] = 0;
  SHARD_BROKEN[shard] = 0;
  SHARD_HEALTH[shard] = SHARD_MAX_HEALTH;
  SHARD_HEALTH_UPDATED_AT[shard] = simulation_time;
  SHARD_IMPACT_COUNT[shard] = 0;
}

static void refresh_shard_health(int32_t shard) {
  if (SHARD_BROKEN[shard]) return;
  double elapsed = simulation_time - SHARD_HEALTH_UPDATED_AT[shard];
  if (elapsed <= 0.0) return;
  double healing = SHARD_MAX_HEALTH - SHARD_HEALTH[shard];
  double available = SHARD_REGENERATION_RATE * elapsed;
  if (healing > available) healing = available;
  SHARD_HEALTH[shard] += healing;
  if (SHARD_HEALTH[shard] > SHARD_MAX_HEALTH) SHARD_HEALTH[shard] = SHARD_MAX_HEALTH;
  int32_t count = SHARD_IMPACT_COUNT[shard];
  int32_t start = shard * MAX_IMPACTS;
  for (int32_t index = 0; index < count && healing > 0.0; index += 1) {
    double healed = SHARD_IMPACT_STRENGTH[start + index] < healing ? SHARD_IMPACT_STRENGTH[start + index] : healing;
    SHARD_IMPACT_STRENGTH[start + index] -= healed;
    healing -= healed;
  }
  int32_t first_alive = 0;
  while (first_alive < count && SHARD_IMPACT_STRENGTH[start + first_alive] <= 0.0001) first_alive += 1;
  if (first_alive > 0) {
    int32_t remaining = count - first_alive;
    for (int32_t index = 0; index < remaining; index += 1) {
      SHARD_IMPACT_ID[start + index] = SHARD_IMPACT_ID[start + first_alive + index];
      SHARD_IMPACT_X[start + index] = SHARD_IMPACT_X[start + first_alive + index];
      SHARD_IMPACT_Y[start + index] = SHARD_IMPACT_Y[start + first_alive + index];
      SHARD_IMPACT_INWARD_X[start + index] = SHARD_IMPACT_INWARD_X[start + first_alive + index];
      SHARD_IMPACT_INWARD_Y[start + index] = SHARD_IMPACT_INWARD_Y[start + first_alive + index];
      SHARD_IMPACT_STRENGTH[start + index] = SHARD_IMPACT_STRENGTH[start + first_alive + index];
    }
    SHARD_IMPACT_COUNT[shard] = remaining;
  }
  SHARD_HEALTH_UPDATED_AT[shard] = simulation_time;
}

static void refresh_damaged_shards(void) {
  int32_t index = 0;
  while (index < damaged_shard_count) {
    int32_t shard = DAMAGED_SHARDS[index];
    refresh_shard_health(shard);
    refresh_shard_growth(shard);
    if ((!SHARD_BROKEN[shard] && !SHARD_GROWING[shard] && SHARD_IMPACT_COUNT[shard] == 0 && SHARD_HEALTH[shard] >= 1.0)
      || (SHARD_BROKEN[shard] && !SHARD_GROWING[shard])) {
      SHARD_DAMAGED[shard] = 0;
      damaged_shard_count -= 1;
      DAMAGED_SHARDS[index] = DAMAGED_SHARDS[damaged_shard_count];
      continue;
    }
    index += 1;
  }
}

static int points_close(double ax, double ay, double bx, double by) {
  double dx = ax - bx;
  double dy = ay - by;
  return dx * dx + dy * dy <= 0.00000025;
}

static int shared_edge_for_shards(
  int32_t first,
  int32_t second,
  double *point_x,
  double *point_y,
  double *inward_x,
  double *inward_y
) {
  int32_t first_start = first * MAX_CELL_POINTS;
  int32_t second_start = second * MAX_CELL_POINTS;
  int32_t first_count = POINT_COUNT[first];
  int32_t second_count = POINT_COUNT[second];
  for (int32_t first_index = 0; first_index < first_count; first_index += 1) {
    int32_t first_next = (first_index + 1) % first_count;
    double first_ax = POINT_X[first_start + first_index];
    double first_ay = POINT_Y[first_start + first_index];
    double first_bx = POINT_X[first_start + first_next];
    double first_by = POINT_Y[first_start + first_next];
    for (int32_t second_index = 0; second_index < second_count; second_index += 1) {
      int32_t second_next = (second_index + 1) % second_count;
      double second_ax = POINT_X[second_start + second_index];
      double second_ay = POINT_Y[second_start + second_index];
      double second_bx = POINT_X[second_start + second_next];
      double second_by = POINT_Y[second_start + second_next];
      int same_direction = points_close(first_ax, first_ay, second_ax, second_ay)
        && points_close(first_bx, first_by, second_bx, second_by);
      int opposite_direction = points_close(first_ax, first_ay, second_bx, second_by)
        && points_close(first_bx, first_by, second_ax, second_ay);
      if (!same_direction && !opposite_direction) continue;

      *point_x = (first_ax + first_bx + second_ax + second_bx) / 4.0;
      *point_y = (first_ay + first_by + second_ay + second_by) / 4.0;
      double edge_x = second_bx - second_ax;
      double edge_y = second_by - second_ay;
      double candidate_inward_x = -edge_y;
      double candidate_inward_y = edge_x;
      double midpoint_x = (second_ax + second_bx) / 2.0 - SHARD_SX[second];
      double midpoint_y = (second_ay + second_by) / 2.0 - SHARD_SY[second];
      if (candidate_inward_x * midpoint_x + candidate_inward_y * midpoint_y < 0.0) {
        candidate_inward_x = -candidate_inward_x;
        candidate_inward_y = -candidate_inward_y;
      }
      double length = sqrt(candidate_inward_x * candidate_inward_x + candidate_inward_y * candidate_inward_y);
      if (length == 0.0) return 0;
      *inward_x = candidate_inward_x / length;
      *inward_y = candidate_inward_y / length;
      return 1;
    }
  }
  return 0;
}

static int32_t edge_matches(
  int32_t first,
  int32_t first_edge,
  int32_t second,
  int32_t second_edge
) {
  int32_t first_start = first * MAX_CELL_POINTS;
  int32_t second_start = second * MAX_CELL_POINTS;
  int32_t first_next = (first_edge + 1) % POINT_COUNT[first];
  int32_t second_next = (second_edge + 1) % POINT_COUNT[second];
  double first_ax = POINT_X[first_start + first_edge];
  double first_ay = POINT_Y[first_start + first_edge];
  double first_bx = POINT_X[first_start + first_next];
  double first_by = POINT_Y[first_start + first_next];
  double second_ax = POINT_X[second_start + second_edge];
  double second_ay = POINT_Y[second_start + second_edge];
  double second_bx = POINT_X[second_start + second_next];
  double second_by = POINT_Y[second_start + second_next];
  return (points_close(first_ax, first_ay, second_ax, second_ay)
    && points_close(first_bx, first_by, second_bx, second_by))
    || (points_close(first_ax, first_ay, second_bx, second_by)
      && points_close(first_bx, first_by, second_ax, second_ay));
}

static int32_t edge_shared_by_selected_shard(int32_t shard, int32_t edge) {
  for (int32_t gy = SHARD_GY[shard] - 4; gy <= SHARD_GY[shard] + 4; gy += 1) {
    for (int32_t gx = SHARD_GX[shard] - 4; gx <= SHARD_GX[shard] + 4; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t neighbor = GRID[grid_index(gx, gy)];
      if (neighbor < 0 || neighbor == shard) continue;
      for (int32_t neighbor_edge = 0; neighbor_edge < POINT_COUNT[neighbor]; neighbor_edge += 1) {
        if (edge_matches(shard, edge, neighbor, neighbor_edge)) return 1;
      }
    }
  }
  return 0;
}

static int32_t point_inside_boundary(double x, double y) {
  int32_t inside = 0;
  for (int32_t edge = 0; edge < field_boundary_point_count; edge += 1) {
    int32_t next = (edge + 1) % field_boundary_point_count;
    double ax = FIELD_BOUNDARY_X[edge];
    double ay = FIELD_BOUNDARY_Y[edge];
    double bx = FIELD_BOUNDARY_X[next];
    double by = FIELD_BOUNDARY_Y[next];
    if ((ay > y) == (by > y)) continue;
    double crossing_x = ax + (y - ay) * (bx - ax) / (by - ay);
    if (x < crossing_x) inside = !inside;
  }
  return inside;
}

static int32_t nearest_boundary_feature(
  double x,
  double y,
  double *point_x,
  double *point_y,
  double *inward_x,
  double *inward_y,
  double *distance
) {
  double best_distance_squared = 1.7976931348623157e+308;
  int32_t found = 0;
  for (int32_t edge = 0; edge < field_boundary_point_count; edge += 1) {
    int32_t next = (edge + 1) % field_boundary_point_count;
    double ax = FIELD_BOUNDARY_X[edge];
    double ay = FIELD_BOUNDARY_Y[edge];
    double bx = FIELD_BOUNDARY_X[next];
    double by = FIELD_BOUNDARY_Y[next];
    double candidate_x, candidate_y;
    closest_point_on_segment(x, y, ax, ay, bx, by, &candidate_x, &candidate_y);
    double offset_x = x - candidate_x;
    double offset_y = y - candidate_y;
    double distance_squared = offset_x * offset_x + offset_y * offset_y;
    if (distance_squared >= best_distance_squared) continue;

    double edge_x = bx - ax;
    double edge_y = by - ay;
    double candidate_inward_x = -edge_y;
    double candidate_inward_y = edge_x;
    double midpoint_x = (ax + bx) / 2.0;
    double midpoint_y = (ay + by) / 2.0;
    if (candidate_inward_x * (-midpoint_x) + candidate_inward_y * (-midpoint_y) < 0.0) {
      candidate_inward_x = -candidate_inward_x;
      candidate_inward_y = -candidate_inward_y;
    }
    double length = sqrt(candidate_inward_x * candidate_inward_x + candidate_inward_y * candidate_inward_y);
    if (length <= 0.000000001) continue;
    best_distance_squared = distance_squared;
    *point_x = candidate_x;
    *point_y = candidate_y;
    *inward_x = candidate_inward_x / length;
    *inward_y = candidate_inward_y / length;
    found = 1;
  }
  if (found) *distance = sqrt(best_distance_squared);
  return found;
}

static void field_edge_points(int32_t shard, int32_t edge, double *ax, double *ay, double *bx, double *by) {
  int32_t start = shard * MAX_CELL_POINTS;
  int32_t next = (edge + 1) % POINT_COUNT[shard];
  *ax = POINT_X[start + edge];
  *ay = POINT_Y[start + edge];
  *bx = POINT_X[start + next];
  *by = POINT_Y[start + next];
}

static int32_t build_generated_field_boundary(void) {
  int32_t edge_count = 0;
  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    for (int32_t edge = 0; edge < POINT_COUNT[shard]; edge += 1) {
      if (!SHARD_BOUNDARY_EDGE[shard * MAX_CELL_POINTS + edge]) continue;
      if (edge_count >= MAX_FIELD_BOUNDARY_POINTS) return 0;
      BOUNDARY_EDGE_SHARD[edge_count] = shard;
      BOUNDARY_EDGE_INDEX[edge_count] = edge;
      edge_count += 1;
    }
  }
  if (edge_count < 3) return 0;

  int32_t used[MAX_FIELD_BOUNDARY_POINTS];
  for (int32_t index = 0; index < edge_count; index += 1) used[index] = 0;
  int32_t current = 0;
  double start_x, start_y, current_x, current_y;
  field_edge_points(BOUNDARY_EDGE_SHARD[current], BOUNDARY_EDGE_INDEX[current], &start_x, &start_y, &current_x, &current_y);
  field_boundary_point_count = 0;

  for (int32_t step = 0; step < edge_count; step += 1) {
    if (field_boundary_point_count >= MAX_FIELD_BOUNDARY_POINTS) return 0;
    double edge_ax, edge_ay, edge_bx, edge_by;
    field_edge_points(BOUNDARY_EDGE_SHARD[current], BOUNDARY_EDGE_INDEX[current], &edge_ax, &edge_ay, &edge_bx, &edge_by);
    if (!points_close(edge_ax, edge_ay, start_x, start_y) && step == 0) return 0;
    FIELD_BOUNDARY_X[field_boundary_point_count] = edge_ax;
    FIELD_BOUNDARY_Y[field_boundary_point_count] = edge_ay;
    field_boundary_point_count += 1;
    used[current] = 1;
    current_x = edge_bx;
    current_y = edge_by;
    if (points_close(current_x, current_y, start_x, start_y)) {
      if (step + 1 != edge_count) return 0;
      return 1;
    }

    int32_t next_edge = -1;
    for (int32_t candidate = 0; candidate < edge_count; candidate += 1) {
      if (used[candidate]) continue;
      double candidate_ax, candidate_ay, candidate_bx, candidate_by;
      field_edge_points(BOUNDARY_EDGE_SHARD[candidate], BOUNDARY_EDGE_INDEX[candidate], &candidate_ax, &candidate_ay, &candidate_bx, &candidate_by);
      if (points_close(candidate_ax, candidate_ay, current_x, current_y)) {
        next_edge = candidate;
        break;
      }
    }
    if (next_edge < 0) return 0;
    current = next_edge;
  }
  return 0;
}

static int32_t boundary_edge_inward_normal(
  int32_t shard,
  int32_t edge,
  double *midpoint_x,
  double *midpoint_y,
  double *inward_x,
  double *inward_y
) {
  double ax, ay, bx, by;
  field_edge_points(shard, edge, &ax, &ay, &bx, &by);
  double edge_x = bx - ax;
  double edge_y = by - ay;
  double candidate_x = -edge_y;
  double candidate_y = edge_x;
  *midpoint_x = (ax + bx) / 2.0;
  *midpoint_y = (ay + by) / 2.0;
  if (candidate_x * (-*midpoint_x) + candidate_y * (-*midpoint_y) < 0.0) {
    candidate_x = -candidate_x;
    candidate_y = -candidate_y;
  }
  double length = sqrt(candidate_x * candidate_x + candidate_y * candidate_y);
  if (length <= 0.000000001) return 0;
  *inward_x = candidate_x / length;
  *inward_y = candidate_y / length;
  return 1;
}

static int32_t boundary_shard_is_reachable(int32_t shard) {
  for (int32_t edge = 0; edge < POINT_COUNT[shard]; edge += 1) {
    if (SHARD_BOUNDARY_EDGE[shard * MAX_CELL_POINTS + edge]) continue;
    double midpoint_x, midpoint_y, inward_x, inward_y;
    if (!boundary_edge_inward_normal(shard, edge, &midpoint_x, &midpoint_y, &inward_x, &inward_y)) continue;
    double ax, ay, bx, by;
    field_edge_points(shard, edge, &ax, &ay, &bx, &by);
    for (int32_t sample = 1; sample <= 9; sample += 1) {
      double ratio = (double)sample / 10.0;
      double edge_x = ax + (bx - ax) * ratio;
      double edge_y = ay + (by - ay) * ratio;
      double ball_x = edge_x + inward_x * (BASE_BALL_RADIUS + COLLISION_SEPARATION + 0.006);
      double ball_y = edge_y + inward_y * (BASE_BALL_RADIUS + COLLISION_SEPARATION + 0.006);
      if (!point_inside_boundary(ball_x, ball_y)) continue;
      int32_t blocked = 0;
      for (int32_t gy = SHARD_GY[shard] - 3; gy <= SHARD_GY[shard] + 3 && !blocked; gy += 1) {
        for (int32_t gx = SHARD_GX[shard] - 3; gx <= SHARD_GX[shard] + 3; gx += 1) {
          if (!in_grid(gx, gy)) continue;
          int32_t other = GRID[grid_index(gx, gy)];
          if (other < 0 || other == shard || !SHARD_HAS_BOUNDARY_EDGE[other]) continue;
          if (circle_intersects_polygon(ball_x, ball_y, BASE_BALL_RADIUS, other)) {
            blocked = 1;
            break;
          }
        }
      }
      if (!blocked) return 1;
    }
  }
  return 0;
}

static int32_t count_reachable_boundary_shards(void) {
  int32_t boundary_shards = 0;
  int32_t reachable_shards = 0;
  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    if (!SHARD_HAS_BOUNDARY_EDGE[shard]) continue;
    boundary_shards += 1;
    if (boundary_shard_is_reachable(shard)) reachable_shards += 1;
  }
  return boundary_shards == reachable_shards ? boundary_shards : -reachable_shards;
}

static void contain_ball(int32_t index) {
  if (index < 0 || index >= ball_count) return;
  const double required_distance = BASE_BALL_RADIUS + COLLISION_SEPARATION;
  for (int32_t iteration = 0; iteration < 8; iteration += 1) {
    double boundary_x, boundary_y, inward_x, inward_y, distance;
    if (!nearest_boundary_feature(BALL_X[index], BALL_Y[index], &boundary_x, &boundary_y, &inward_x, &inward_y, &distance)) return;
    if (point_inside_boundary(BALL_X[index], BALL_Y[index]) && distance >= required_distance) return;
    BALL_X[index] = boundary_x + inward_x * required_distance;
    BALL_Y[index] = boundary_y + inward_y * required_distance;
  }
}

static int32_t contains_shard(const int32_t *shards, int32_t count, int32_t target) {
  for (int32_t index = 0; index < count; index += 1) {
    if (shards[index] == target) return 1;
  }
  return 0;
}

static int32_t collect_touching_shards(int32_t source, int32_t *neighbors, int32_t max_neighbors) {
  int32_t source_gx = SHARD_GX[source];
  int32_t source_gy = SHARD_GY[source];
  int32_t neighbor_count = 0;
  for (int32_t gy = source_gy - 3; gy <= source_gy + 3; gy += 1) {
    for (int32_t gx = source_gx - 3; gx <= source_gx + 3; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t neighbor = GRID[grid_index(gx, gy)];
      if (neighbor < 0 || neighbor == source || SHARD_BROKEN[neighbor]) continue;
      if (contains_shard(neighbors, neighbor_count, neighbor)) continue;
      double shared_x, shared_y, inward_x, inward_y;
      if (!shared_edge_for_shards(source, neighbor, &shared_x, &shared_y, &inward_x, &inward_y)) continue;
      if (neighbor_count < max_neighbors) neighbors[neighbor_count++] = neighbor;
    }
  }
  return neighbor_count;
}

static void damage_shard(
  int32_t shard,
  double damage,
  double point_x,
  double point_y,
  double inward_x,
  double inward_y,
  int32_t awards_hit
) {
  if (SHARD_BROKEN[shard]) return;
  refresh_shard_health(shard);
  double remaining_health = SHARD_HEALTH[shard] - damage;
  SHARD_HEALTH[shard] = remaining_health <= HEALTH_EPSILON ? 0.0 : remaining_health;
  add_impact(shard, point_x, point_y, inward_x, inward_y, damage);
  if (awards_hit) {
    total_hits += 1;
    score += 1.0;
  }
  if (SHARD_HEALTH[shard] <= 0.0 && !SHARD_BROKEN[shard]) {
    SHARD_HEALTH[shard] = 0.0;
    SHARD_BROKEN[shard] = 1;
    total_breaks += 1;
    recent_break_rate += 60.0 / RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS;
    score += 100.0;
    record_event(3, shard, shard);
  }
}

static double damage_multiplier_for_ball(int32_t ball) {
  double multiplier = 1.0;
  if (chosen_one_unlocked && ball == CHOSEN_BALL_INDEX) multiplier *= CHOSEN_ONE_DAMAGE_MULTIPLIER;
  if (BALL_CORROSIVE_WAKE_CHARGED[ball]) multiplier *= CHOSEN_ONE_DAMAGE_MULTIPLIER;
  return multiplier;
}

static void apply_resonance(int32_t source, double splash_multiplier) {
  if (!resonance_unlocked) return;
  int32_t first_neighbors[MAX_TOUCHING_SHARDS];
  int32_t first_count = collect_touching_shards(source, first_neighbors, MAX_TOUCHING_SHARDS);
  for (int32_t index = 0; index < first_count; index += 1) {
    int32_t neighbor = first_neighbors[index];
    double shared_x, shared_y, inward_x, inward_y;
    if (!shared_edge_for_shards(source, neighbor, &shared_x, &shared_y, &inward_x, &inward_y)) continue;
    record_event(2, neighbor, source);
    damage_shard(neighbor, RESONANCE_SPLASH_DAMAGE * splash_multiplier, shared_x, shared_y, inward_x, inward_y, 0);
  }

  if (!conduction_unlocked) return;
  int32_t second_neighbors[MAX_SECOND_NEIGHBORS];
  int32_t second_parents[MAX_SECOND_NEIGHBORS];
  int32_t second_count = 0;
  for (int32_t first_index = 0; first_index < first_count; first_index += 1) {
    int32_t candidates[MAX_TOUCHING_SHARDS];
    int32_t candidate_count = collect_touching_shards(first_neighbors[first_index], candidates, MAX_TOUCHING_SHARDS);
    for (int32_t candidate_index = 0; candidate_index < candidate_count; candidate_index += 1) {
      int32_t candidate = candidates[candidate_index];
      if (candidate == source || contains_shard(first_neighbors, first_count, candidate)) continue;
      if (contains_shard(second_neighbors, second_count, candidate)) continue;
      if (second_count >= MAX_SECOND_NEIGHBORS) continue;
      second_neighbors[second_count] = candidate;
      second_parents[second_count] = first_neighbors[first_index];
      second_count += 1;
    }
  }
  for (int32_t index = 0; index < second_count; index += 1) {
    int32_t neighbor = second_neighbors[index];
    double shared_x, shared_y, inward_x, inward_y;
    if (!shared_edge_for_shards(second_parents[index], neighbor, &shared_x, &shared_y, &inward_x, &inward_y)) continue;
    record_event(4, neighbor, source);
    damage_shard(neighbor, CONDUCTION_SPLASH_DAMAGE * splash_multiplier, shared_x, shared_y, inward_x, inward_y, 0);
  }
}

static int32_t build_field_geometry(double field_seed) {
  shard_count = 0;
  damaged_shard_count = 0;
  field_boundary_point_count = 0;
  for (int32_t index = 0; index < GRID_CELLS; index += 1) GRID[index] = -1;
  build_field_clip_boundary(field_seed);
  for (int32_t gy = GRID_MIN; gy <= GRID_MAX; gy += 1) {
    for (int32_t gx = GRID_MIN; gx <= GRID_MAX; gx += 1) {
      if (!field_site_included(gx, gy)) continue;
      double cell_x[MAX_CELL_POINTS];
      double cell_y[MAX_CELL_POINTS];
      double site_x;
      double site_y;
      int32_t point_count = build_cell(gx, gy, field_seed, &site_x, &site_y, cell_x, cell_y);
      if (point_count < 3) continue;

      int32_t shard = shard_count++;
      int32_t grid_slot = grid_index(gx, gy);
      GRID[grid_slot] = shard;
      SHARD_GX[shard] = gx;
      SHARD_GY[shard] = gy;
      int32_t point_start = shard * MAX_CELL_POINTS;
      SHARD_SX[shard] = site_x;
      SHARD_SY[shard] = site_y;
      POINT_COUNT[shard] = point_count;
      for (int32_t point = 0; point < point_count; point += 1) {
        POINT_X[point_start + point] = cell_x[point];
        POINT_Y[point_start + point] = cell_y[point];
      }
      CENTER_X[shard] = SHARD_SX[shard];
      CENTER_Y[shard] = SHARD_SY[shard];
      SHARD_HEALTH[shard] = SHARD_MAX_HEALTH;
      SHARD_HEALTH_UPDATED_AT[shard] = 0.0;
      SHARD_GROWTH[shard] = 0.0;
      SHARD_GROWING[shard] = 0;
      SHARD_GROWTH_PENDING[shard] = 0;
      SHARD_SEED[shard] = seeded_hash((double)gx + 4.8, (double)gy - 2.3, field_seed);
      SHARD_HUE[shard] = 162.0 + seeded_hash((double)gx + 4.8, (double)gy - 2.3, field_seed) * 72.0 + sqrt((double)gx * gx + (double)gy * gy) * 2.2;
      SHARD_BROKEN[shard] = circle_intersects_polygon(0.0, 0.0, BASE_BALL_RADIUS, shard);
      SHARD_IMPACT_COUNT[shard] = 0;
      SHARD_DAMAGED[shard] = 0;
      SHARD_HAS_BOUNDARY_EDGE[shard] = 0;
    }
  }
  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    int32_t edge_start = shard * MAX_CELL_POINTS;
    for (int32_t edge = 0; edge < POINT_COUNT[shard]; edge += 1) {
      SHARD_BOUNDARY_EDGE[edge_start + edge] = edge_shared_by_selected_shard(shard, edge) ? 0 : 1;
      if (SHARD_BOUNDARY_EDGE[edge_start + edge]) SHARD_HAS_BOUNDARY_EDGE[shard] = 1;
    }
  }
  return build_generated_field_boundary();
}

static int32_t remove_inaccessible_boundary_sites(void) {
  // A boundary shard hidden behind other boundary shards is a protrusion from
  // the circular site field. Remove that outer site and rebuild the ring so
  // the remaining perimeter is a single reachable layer of full cells.
  int32_t removed = 0;
  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    if (!SHARD_HAS_BOUNDARY_EDGE[shard] || boundary_shard_is_reachable(shard)) continue;
    int32_t slot = grid_index(SHARD_GX[shard], SHARD_GY[shard]);
    if (!FIELD_SITE_SELECTED[slot]) continue;
    FIELD_SITE_SELECTED[slot] = 0;
    removed += 1;
  }
  return removed;
}

static int32_t initialize_field_candidate(double field_seed) {
  for (int32_t index = 0; index < GRID_CELLS; index += 1) FIELD_SITE_SELECTED[index] = 0;
  for (int32_t gy = GRID_MIN; gy <= GRID_MAX; gy += 1) {
    for (int32_t gx = GRID_MIN; gx <= GRID_MAX; gx += 1) {
      if (sqrt((double)gx * gx + (double)gy * gy) <= FIELD_SITE_SELECTION_RADIUS) {
        FIELD_SITE_SELECTED[grid_index(gx, gy)] = 1;
      }
    }
  }

  for (int32_t repair = 0; repair < MAX_FIELD_LAYOUT_ATTEMPTS; repair += 1) {
    if (!build_field_geometry(field_seed)) return 0;
    if (count_reachable_boundary_shards() > 0) return 1;
    if (!remove_inaccessible_boundary_sites()) return 0;
  }
  return 0;
}

static void initialize_field(double field_seed) {
  current_field_seed = field_seed;
  field_layout_variant = 0;
  for (int32_t attempt = 0; attempt < MAX_FIELD_LAYOUT_ATTEMPTS; attempt += 1) {
    field_layout_variant = attempt;
    if (initialize_field_candidate(field_seed)) return;
  }
  // The deterministic shuffle attempts above should always find a valid ring.
  // Keep the final candidate as a last-resort playable field if a future
  // geometry change makes the reachability constraint unexpectedly strict.
  initialize_field_candidate(field_seed);
}

static void initialize_balls(uint32_t seed, double field_seed_override, int32_t requested_balls) {
  rng_state = seed ? seed : 0x9e3779b9u;
  double field_seed;
  if (field_seed_override == field_seed_override) field_seed = field_seed_override;
  else field_seed = rng_next() * 100000.0;
  initialize_field(field_seed);
  ball_count = 0;
  score = 9007199254740991.0;
  total_hits = 0;
  total_breaks = 0;
  recent_break_rate = 0.0;
  simulation_time = 0.0;
  next_impact_id = 1;
  chosen_one_unlocked = 0;
  corrosive_wake_unlocked = 0;
  new_growth_unlocked = 0;
  resonance_unlocked = 0;
  conduction_unlocked = 0;
  germination_unlocked = 0;
  event_count = 0;
  corrosive_wake_segment_count = 0;
  seed_count = 0;
  for (int32_t index = 0; index < MAX_BALLS; index += 1) BALL_NEXT_SEED_AT[index] = 0.0;

  double initial_direction = rng_next() * TAU;
  BALL_X[0] = 0.0;
  BALL_Y[0] = 0.0;
  BALL_VX[0] = cos(initial_direction) * INITIAL_BALL_SPEED;
  BALL_VY[0] = sin(initial_direction) * INITIAL_BALL_SPEED;
  BALL_HIT_COOLDOWN[0] = 0.0;
  BALL_CORROSIVE_WAKE_CHARGED[0] = 0;
  BALL_NEXT_SEED_AT[0] = 0.0;
  ball_count = 1;

  while (ball_count < requested_balls && ball_count < MAX_BALLS) {
    int32_t current_count = ball_count;
    double cost = 300.0;
    for (int32_t index = 1; index < current_count; index += 1) cost *= BALL_COST_GROWTH;
    double spawn_angle = current_count * 2.2 + 0.4;
    double direction = rng_next() * TAU;
    score -= cost;
    BALL_X[current_count] = cos(spawn_angle) * 0.22;
    BALL_Y[current_count] = sin(spawn_angle) * 0.22;
    BALL_VX[current_count] = cos(direction) * INITIAL_BALL_SPEED;
    BALL_VY[current_count] = sin(direction) * INITIAL_BALL_SPEED;
    BALL_HIT_COOLDOWN[current_count] = 0.0;
    BALL_CORROSIVE_WAKE_CHARGED[current_count] = 0;
    BALL_NEXT_SEED_AT[current_count] = 0.0;
    ball_count += 1;
  }
}

typedef struct {
  int32_t valid;
  int32_t shard;
  int32_t boundary;
  double time;
  double point_x;
  double point_y;
  double normal_x;
  double normal_y;
} Collision;

typedef struct {
  double point_x;
  double point_y;
  double distance;
  double normal_x;
  double normal_y;
} Feature;

static Feature nearest_feature(double x, double y, int32_t shard) {
  Feature result = {0.0, 0.0, 1.7976931348623157e+308, 0.0, 0.0};
  int32_t count = POINT_COUNT[shard];
  int32_t start = shard * MAX_CELL_POINTS;
  for (int32_t index = 0; index < count; index += 1) {
    int32_t next = (index + 1) % count;
    double ax = POINT_X[start + index];
    double ay = POINT_Y[start + index];
    double bx = POINT_X[start + next];
    double by = POINT_Y[start + next];
    double point_x, point_y;
    closest_point_on_segment(x, y, ax, ay, bx, by, &point_x, &point_y);
    double distance_x = x - point_x;
    double distance_y = y - point_y;
    double distance_squared = distance_x * distance_x + distance_y * distance_y;
    if (distance_squared >= result.distance * result.distance) continue;
    double edge_x = bx - ax;
    double edge_y = by - ay;
    double inward_x = -edge_y;
    double inward_y = edge_x;
    double midpoint_x = (ax + bx) / 2.0 - SHARD_SX[shard];
    double midpoint_y = (ay + by) / 2.0 - SHARD_SY[shard];
    if (inward_x * midpoint_x + inward_y * midpoint_y > 0.0) {
      inward_x = -inward_x;
      inward_y = -inward_y;
    }
    double normal_length = sqrt(inward_x * inward_x + inward_y * inward_y);
    if (normal_length == 0.0) normal_length = 1.0;
    result.point_x = point_x;
    result.point_y = point_y;
    result.distance = sqrt(distance_squared);
    result.normal_x = -inward_x / normal_length;
    result.normal_y = -inward_y / normal_length;
  }
  return result;
}

static void outward_normal_from_feature(double x, double y, Feature feature, double *normal_x, double *normal_y) {
  double distance_x = x - feature.point_x;
  double distance_y = y - feature.point_y;
  double distance = sqrt(distance_x * distance_x + distance_y * distance_y);
  if (distance < 0.000001) {
    *normal_x = feature.normal_x;
    *normal_y = feature.normal_y;
  } else {
    *normal_x = distance_x / distance;
    *normal_y = distance_y / distance;
  }
}

static void consider_collision(Collision *best, int32_t shard, int32_t boundary, double time, double point_x, double point_y, double normal_x, double normal_y) {
  if (time < -0.000001 || time > 1.000001 || (best->valid && time >= best->time)) return;
  best->valid = 1;
  best->shard = shard;
  best->boundary = boundary;
  best->time = time < 0.0 ? 0.0 : time > 1.0 ? 1.0 : time;
  best->point_x = point_x;
  best->point_y = point_y;
  best->normal_x = normal_x;
  best->normal_y = normal_y;
}

static void consider_boundary_edge_collision(
  Collision *best,
  int32_t shard,
  int32_t edge_index,
  double x,
  double y,
  double movement_x,
  double movement_y,
  double radius
) {
  int32_t start = shard * MAX_CELL_POINTS;
  int32_t next = (edge_index + 1) % POINT_COUNT[shard];
  double ax = POINT_X[start + edge_index];
  double ay = POINT_Y[start + edge_index];
  double bx = POINT_X[start + next];
  double by = POINT_Y[start + next];
  double edge_x = bx - ax;
  double edge_y = by - ay;
  double edge_length_squared = edge_x * edge_x + edge_y * edge_y;
  if (edge_length_squared <= 0.000000000001) return;

  double inward_x = -edge_y;
  double inward_y = edge_x;
  double midpoint_x = (ax + bx) / 2.0;
  double midpoint_y = (ay + by) / 2.0;
  if (inward_x * (-midpoint_x) + inward_y * (-midpoint_y) < 0.0) {
    inward_x = -inward_x;
    inward_y = -inward_y;
  }
  double normal_length = sqrt(inward_x * inward_x + inward_y * inward_y);
  if (normal_length <= 0.000000001) return;
  inward_x /= normal_length;
  inward_y /= normal_length;

  double signed_start = (x - ax) * inward_x + (y - ay) * inward_y;
  double signed_movement = movement_x * inward_x + movement_y * inward_y;
  if (signed_start >= -radius && signed_movement < -0.000000001) {
    double time = signed_start <= radius ? 0.0 : (radius - signed_start) / signed_movement;
    if (time >= -0.000001 && time <= 1.000001) {
      double center_x = x + movement_x * time;
      double center_y = y + movement_y * time;
      double projection = ((center_x - ax) * edge_x + (center_y - ay) * edge_y) / edge_length_squared;
      if (projection >= -0.000001 && projection <= 1.000001) {
        if (projection < 0.0) projection = 0.0;
        if (projection > 1.0) projection = 1.0;
        consider_collision(best, shard, 1, time, ax + edge_x * projection, ay + edge_y * projection, inward_x, inward_y);
      }
    }
  }

  double movement_length_squared = movement_x * movement_x + movement_y * movement_y;
  if (movement_length_squared <= 0.0) return;
  for (int32_t endpoint = 0; endpoint < 2; endpoint += 1) {
    double vertex_x = endpoint == 0 ? ax : bx;
    double vertex_y = endpoint == 0 ? ay : by;
    double offset_x = x - vertex_x;
    double offset_y = y - vertex_y;
    double coefficient_b = 2.0 * (offset_x * movement_x + offset_y * movement_y);
    double coefficient_c = offset_x * offset_x + offset_y * offset_y - radius * radius;
    double discriminant = coefficient_b * coefficient_b - 4.0 * movement_length_squared * coefficient_c;
    if (discriminant < 0.0) continue;
    double root = (-coefficient_b - sqrt(discriminant)) / (2.0 * movement_length_squared);
    if (root < -0.000001 || root > 1.000001) continue;
    double center_x = x + movement_x * root;
    double center_y = y + movement_y * root;
    double normal_x = center_x - vertex_x;
    double normal_y = center_y - vertex_y;
    double endpoint_normal_length = sqrt(normal_x * normal_x + normal_y * normal_y);
    if (endpoint_normal_length <= 0.000000001) continue;
    normal_x /= endpoint_normal_length;
    normal_y /= endpoint_normal_length;
    if (movement_x * normal_x + movement_y * normal_y >= 0.0) continue;
    if (normal_x * inward_x + normal_y * inward_y < -0.000001) continue;
    consider_collision(best, shard, 1, root, vertex_x, vertex_y, normal_x, normal_y);
  }
}

static Collision collision_for(double x, double y, double next_x, double next_y, double radius) {
  Collision best = {0, -1, 0, 0.0, 0.0, 0.0, 0.0, 0.0};
  double movement_x = next_x - x;
  double movement_y = next_y - y;
  int32_t min_x = (int32_t)floor(x < next_x ? x : next_x) - 1;
  int32_t max_x = (int32_t)floor(x > next_x ? x : next_x);
  if ((x > next_x ? x : next_x) > (double)max_x) max_x += 1;
  max_x += 1;
  int32_t min_y = (int32_t)floor(y < next_y ? y : next_y) - 1;
  int32_t max_y = (int32_t)floor(y > next_y ? y : next_y);
  if ((y > next_y ? y : next_y) > (double)max_y) max_y += 1;
  max_y += 1;

  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    int32_t count = POINT_COUNT[shard];
    int32_t start = shard * MAX_CELL_POINTS;
    for (int32_t index = 0; index < count; index += 1) {
      if (!SHARD_BOUNDARY_EDGE[start + index]) continue;
      consider_boundary_edge_collision(&best, shard, index, x, y, movement_x, movement_y, radius);
    }
  }

  for (int32_t gy = min_y; gy <= max_y; gy += 1) {
    for (int32_t gx = min_x; gx <= max_x; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t shard = GRID[grid_index(gx, gy)];
      if (shard < 0) continue;
      int32_t count = POINT_COUNT[shard];
      int32_t start = shard * MAX_CELL_POINTS;
      if (SHARD_BROKEN[shard]) continue;
      int32_t start_inside = point_in_polygon(x, y, shard);
      Feature nearest_start = nearest_feature(x, y, shard);
      if (start_inside || nearest_start.distance < radius) {
        double start_normal_x, start_normal_y;
        if (start_inside) {
          start_normal_x = nearest_start.normal_x;
          start_normal_y = nearest_start.normal_y;
        } else {
          outward_normal_from_feature(x, y, nearest_start, &start_normal_x, &start_normal_y);
        }
        if (movement_x * start_normal_x + movement_y * start_normal_y < 0.0) {
          consider_collision(&best, shard, 0, 0.0, nearest_start.point_x, nearest_start.point_y, start_normal_x, start_normal_y);
        }
        continue;
      }

      int32_t end_inside = point_in_polygon(next_x, next_y, shard);
      Feature nearest_end = nearest_feature(next_x, next_y, shard);
      double end_normal_x, end_normal_y;
      if (end_inside) {
        end_normal_x = nearest_end.normal_x;
        end_normal_y = nearest_end.normal_y;
      } else {
        outward_normal_from_feature(next_x, next_y, nearest_end, &end_normal_x, &end_normal_y);
      }
      if (end_inside || (nearest_end.distance < radius && movement_x * end_normal_x + movement_y * end_normal_y < 0.0)) {
        consider_collision(&best, shard, 0, 1.0, nearest_end.point_x, nearest_end.point_y, end_normal_x, end_normal_y);
      }

      for (int32_t index = 0; index < count; index += 1) {
        int32_t next = (index + 1) % count;
        double ax = POINT_X[start + index];
        double ay = POINT_Y[start + index];
        double bx = POINT_X[start + next];
        double by = POINT_Y[start + next];
        double edge_x = bx - ax;
        double edge_y = by - ay;
        double edge_length_squared = edge_x * edge_x + edge_y * edge_y;
        double inward_x = -edge_y;
        double inward_y = edge_x;
        double midpoint_x = (ax + bx) / 2.0 - SHARD_SX[shard];
        double midpoint_y = (ay + by) / 2.0 - SHARD_SY[shard];
        if (inward_x * midpoint_x + inward_y * midpoint_y > 0.0) {
          inward_x = -inward_x;
          inward_y = -inward_y;
        }
        double normal_length = sqrt(inward_x * inward_x + inward_y * inward_y);
        if (normal_length == 0.0) normal_length = 1.0;
        inward_x /= normal_length;
        inward_y /= normal_length;
        double signed_start = (x - ax) * inward_x + (y - ay) * inward_y;
        double signed_movement = movement_x * inward_x + movement_y * inward_y;
        if (signed_movement <= 0.0 || signed_start >= -radius) continue;
        double time = (-radius - signed_start) / signed_movement;
        double center_x = x + movement_x * time;
        double center_y = y + movement_y * time;
        double projection = ((center_x - ax) * edge_x + (center_y - ay) * edge_y) / edge_length_squared;
        if (projection < -0.000001 || projection > 1.000001) continue;
        if (projection < 0.0) projection = 0.0;
        if (projection > 1.0) projection = 1.0;
        consider_collision(&best, shard, 0, time, ax + edge_x * projection, ay + edge_y * projection, -inward_x, -inward_y);
      }

      double movement_length_squared = movement_x * movement_x + movement_y * movement_y;
      if (movement_length_squared > 0.0) {
        for (int32_t index = 0; index < count; index += 1) {
          double vertex_x = POINT_X[start + index];
          double vertex_y = POINT_Y[start + index];
          double offset_x = x - vertex_x;
          double offset_y = y - vertex_y;
          double coefficient_b = 2.0 * (offset_x * movement_x + offset_y * movement_y);
          double coefficient_c = offset_x * offset_x + offset_y * offset_y - radius * radius;
          double discriminant = coefficient_b * coefficient_b - 4.0 * movement_length_squared * coefficient_c;
          if (discriminant < 0.0) continue;
          double root = (-coefficient_b - sqrt(discriminant)) / (2.0 * movement_length_squared);
          if (root < -0.000001 || root > 1.000001) continue;
          double center_x = x + movement_x * root;
          double center_y = y + movement_y * root;
          double normal_x = center_x - vertex_x;
          double normal_y = center_y - vertex_y;
          double normal_length = sqrt(normal_x * normal_x + normal_y * normal_y);
          if (normal_length == 0.0) normal_length = 1.0;
          if (movement_x * normal_x + movement_y * normal_y >= 0.0) continue;
          consider_collision(&best, shard, 0, root, vertex_x, vertex_y, normal_x / normal_length, normal_y / normal_length);
        }
      }
    }
  }
  return best;
}

// RETAINED LEGACY NEW GROWTH IMPLEMENTATION: this path is intentionally
// inactive while the old branch is removed. Keep it nearby so the empty-cell
// growth behavior can be reused in a later tech.
static void process_growth_path(int32_t ball, double x, double y, double next_x, double next_y) {
  if (!new_growth_unlocked && damaged_shard_count == 0) return;
  int32_t min_x = (int32_t)floor(x < next_x ? x : next_x) - 1;
  int32_t max_x = (int32_t)floor(x > next_x ? x : next_x) + 1;
  int32_t min_y = (int32_t)floor(y < next_y ? y : next_y) - 1;
  int32_t max_y = (int32_t)floor(y > next_y ? y : next_y) + 1;
  int32_t can_start = new_growth_unlocked && ball == CHOSEN_BALL_INDEX;
  for (int32_t gy = min_y; gy <= max_y; gy += 1) {
    for (int32_t gx = min_x; gx <= max_x; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t shard = GRID[grid_index(gx, gy)];
      if (shard < 0) continue;
      int32_t path_intersects = segment_intersects_polygon(x, y, next_x, next_y, BASE_BALL_RADIUS, shard);
      if (SHARD_GROWING[shard] && path_intersects) {
        reset_shard_growth(shard);
        continue;
      }
      if (!can_start || !SHARD_BROKEN[shard]) continue;

      int32_t current_overlaps = circle_intersects_polygon(x, y, BASE_BALL_RADIUS, shard);
      int32_t endpoint_overlaps = circle_intersects_polygon(next_x, next_y, BASE_BALL_RADIUS, shard);
      if (SHARD_GROWTH_PENDING[shard]) {
        if (!current_overlaps && (!path_intersects || !endpoint_overlaps)) begin_shard_growth(shard);
        continue;
      }
      if (!path_intersects) continue;
      if (current_overlaps || endpoint_overlaps) SHARD_GROWTH_PENDING[shard] = 1;
      else begin_shard_growth(shard);
    }
  }
}

static void resolve_ball_collisions(void) {
  const double minimum_distance = BASE_BALL_RADIUS * 2.0;
  const double minimum_distance_squared = minimum_distance * minimum_distance;
  for (int32_t first = 0; first < ball_count; first += 1) {
    for (int32_t second = first + 1; second < ball_count; second += 1) {
      double delta_x = BALL_X[first] - BALL_X[second];
      double delta_y = BALL_Y[first] - BALL_Y[second];
      double distance_squared = delta_x * delta_x + delta_y * delta_y;
      if (distance_squared >= minimum_distance_squared) continue;

      double distance = sqrt(distance_squared);
      double normal_x;
      double normal_y;
      if (distance > 0.000001) {
        normal_x = delta_x / distance;
        normal_y = delta_y / distance;
      } else {
        double relative_velocity_x = BALL_VX[first] - BALL_VX[second];
        double relative_velocity_y = BALL_VY[first] - BALL_VY[second];
        double relative_speed = sqrt(relative_velocity_x * relative_velocity_x + relative_velocity_y * relative_velocity_y);
        if (relative_speed > 0.000001) {
          normal_x = relative_velocity_x / relative_speed;
          normal_y = relative_velocity_y / relative_speed;
        } else {
          normal_x = 1.0;
          normal_y = 0.0;
        }
      }

      double relative_velocity = (BALL_VX[first] - BALL_VX[second]) * normal_x
        + (BALL_VY[first] - BALL_VY[second]) * normal_y;
      if (relative_velocity < 0.0) {
        BALL_VX[first] -= relative_velocity * normal_x;
        BALL_VY[first] -= relative_velocity * normal_y;
        BALL_VX[second] += relative_velocity * normal_x;
        BALL_VY[second] += relative_velocity * normal_y;
      }

      double correction = (minimum_distance - distance + COLLISION_SEPARATION) * 0.5;
      BALL_X[first] += normal_x * correction;
      BALL_Y[first] += normal_y * correction;
      BALL_X[second] -= normal_x * correction;
      BALL_Y[second] -= normal_y * correction;
    }
  }
}

static void preserve_total_ball_kinetic_energy(void) {
  if (ball_count <= 0) return;

  const double target_energy = (double)ball_count * INITIAL_BALL_SPEED * INITIAL_BALL_SPEED;
  double current_energy = 0.0;
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    current_energy += BALL_VX[ball] * BALL_VX[ball] + BALL_VY[ball] * BALL_VY[ball];
  }

  if (current_energy > target_energy + KINETIC_ENERGY_TOLERANCE) {
    double excess_energy = current_energy - target_energy;
    while (excess_energy > KINETIC_ENERGY_TOLERANCE) {
      int32_t fastest_ball = -1;
      double fastest_energy = 0.0;
      for (int32_t ball = 0; ball < ball_count; ball += 1) {
        double ball_energy = BALL_VX[ball] * BALL_VX[ball] + BALL_VY[ball] * BALL_VY[ball];
        if (ball_energy > fastest_energy) {
          fastest_ball = ball;
          fastest_energy = ball_energy;
        }
      }
      if (fastest_ball < 0) break;

      double removed_energy = excess_energy < fastest_energy ? excess_energy : fastest_energy;
      double corrected_energy = fastest_energy - removed_energy;
      if (fastest_energy > KINETIC_ENERGY_TOLERANCE) {
        double speed_scale = sqrt(corrected_energy / fastest_energy);
        BALL_VX[fastest_ball] *= speed_scale;
        BALL_VY[fastest_ball] *= speed_scale;
      } else {
        BALL_VX[fastest_ball] = 0.0;
        BALL_VY[fastest_ball] = 0.0;
      }
      excess_energy -= removed_energy;
    }
    return;
  }

  if (current_energy + KINETIC_ENERGY_TOLERANCE < target_energy) {
    double deficit_energy = target_energy - current_energy;
    int32_t slowest_ball = -1;
    double slowest_energy = 0.0;
    for (int32_t ball = 0; ball < ball_count; ball += 1) {
      double ball_energy = BALL_VX[ball] * BALL_VX[ball] + BALL_VY[ball] * BALL_VY[ball];
      if (ball_energy <= KINETIC_ENERGY_TOLERANCE) continue;
      if (slowest_ball < 0 || ball_energy < slowest_energy) {
        slowest_ball = ball;
        slowest_energy = ball_energy;
      }
    }
    if (slowest_ball < 0) return;

    double corrected_energy = slowest_energy + deficit_energy;
    double speed_scale = sqrt(corrected_energy / slowest_energy);
    BALL_VX[slowest_ball] *= speed_scale;
    BALL_VY[slowest_ball] *= speed_scale;
  }
}

static void step_simulation(void) {
  simulation_time += FIXED_TIMESTEP;
  recent_break_rate *= exp(-FIXED_TIMESTEP / RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS);
  refresh_corrosive_wake();
  refresh_seeds();
  event_count = 0;
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    BALL_HIT_COOLDOWN[ball] -= FIXED_TIMESTEP;
    if (BALL_HIT_COOLDOWN[ball] < 0.0) BALL_HIT_COOLDOWN[ball] = 0.0;
    double remaining = FIXED_TIMESTEP;
    int32_t collision_count = 0;
    while (remaining > 0.000001 && collision_count < MAX_COLLISIONS_PER_STEP) {
      double next_x = BALL_X[ball] + BALL_VX[ball] * remaining;
      double next_y = BALL_Y[ball] + BALL_VY[ball] * remaining;
      collect_seeds_on_segment(BALL_X[ball], BALL_Y[ball], next_x, next_y);
      if (ball != CHOSEN_BALL_INDEX) {
        charge_ball_from_corrosive_wake(ball, BALL_X[ball], BALL_Y[ball], next_x, next_y);
      }
      Collision collision = collision_for(BALL_X[ball], BALL_Y[ball], next_x, next_y, BASE_BALL_RADIUS);
      if (!collision.valid) {
        if (ball == CHOSEN_BALL_INDEX) add_corrosive_wake_segment(BALL_X[ball], BALL_Y[ball], next_x, next_y);
        BALL_X[ball] = next_x;
        BALL_Y[ball] = next_y;
        break;
      }
      if (ball == CHOSEN_BALL_INDEX) add_corrosive_wake_segment(BALL_X[ball], BALL_Y[ball], collision.point_x, collision.point_y);
      double velocity_along_normal = BALL_VX[ball] * collision.normal_x + BALL_VY[ball] * collision.normal_y;
      BALL_X[ball] = collision.point_x + collision.normal_x * (BASE_BALL_RADIUS + COLLISION_SEPARATION);
      BALL_Y[ball] = collision.point_y + collision.normal_y * (BASE_BALL_RADIUS + COLLISION_SEPARATION);
      if (velocity_along_normal < 0.0) {
        BALL_VX[ball] -= 2.0 * velocity_along_normal * collision.normal_x;
        BALL_VY[ball] -= 2.0 * velocity_along_normal * collision.normal_y;
        double jitter = (rng_next() * 2.0 - 1.0) * BOUNCE_JITTER_RADIANS;
        double jitter_cosine = cos(jitter);
        double jitter_sine = sin(jitter);
        double bounced_x = BALL_VX[ball];
        double bounced_y = BALL_VY[ball];
        BALL_VX[ball] = bounced_x * jitter_cosine - bounced_y * jitter_sine;
        BALL_VY[ball] = bounced_x * jitter_sine + bounced_y * jitter_cosine;
        record_event(1, collision.shard, collision.shard);
        if (!collision.boundary) {
          double damage_multiplier = damage_multiplier_for_ball(ball);
          if (BALL_HIT_COOLDOWN[ball] <= 0.0) {
            damage_shard(
              collision.shard,
              BASE_HIT_DAMAGE * damage_multiplier,
              collision.point_x,
              collision.point_y,
              -collision.normal_x,
              -collision.normal_y,
              1
            );
            if (BALL_CORROSIVE_WAKE_CHARGED[ball]) {
              BALL_CORROSIVE_WAKE_CHARGED[ball] = 0;
            }
            BALL_HIT_COOLDOWN[ball] = 0.14;
          }
          apply_resonance(collision.shard, damage_multiplier);
        }
      }
      remaining *= (1.0 - collision.time) > 0.0 ? 1.0 - collision.time : 0.0;
      collision_count += 1;
    }
  }
  resolve_ball_collisions();
  preserve_total_ball_kinetic_energy();
  spawn_seeds_due();
  refresh_damaged_shards();
}

static double make_checksum(void) {
  double checksum = score * 0.0000000001 + (double)total_hits * 1.7 + (double)total_breaks * 19.3 + recent_break_rate * 0.23 + simulation_time * 0.31;
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    checksum += BALL_X[ball] * 0.17 + BALL_Y[ball] * 0.31 + BALL_VX[ball] * 0.43 + BALL_VY[ball] * 0.59;
  }
  for (int32_t shard = 0; shard < shard_count; shard += 1) {
    checksum += SHARD_HEALTH[shard] * 0.00013 + (double)SHARD_BROKEN[shard] * 0.000017;
  }
  return checksum;
}

static void finalize_simulation(void) {
  last_score = score;
  last_hits = total_hits;
  last_breaks = total_breaks;
  last_shards = shard_count;
  last_checksum = make_checksum();
}

__attribute__((export_name("initialize_real_simulation"))) void initialize_real_simulation(uint32_t seed, double field_seed_override, int32_t requested_balls) {
  int32_t requested = requested_balls < 1 ? 1 : requested_balls > MAX_BALLS ? MAX_BALLS : requested_balls;
  initialize_balls(seed, field_seed_override, requested);
}

__attribute__((export_name("step_real_simulation"))) void step_real_simulation(int32_t steps) {
  int32_t step_count = steps < 0 ? 0 : steps;
  for (int32_t step = 0; step < step_count; step += 1) step_simulation();
}

__attribute__((export_name("finish_real_simulation"))) double finish_real_simulation(void) {
  finalize_simulation();
  return last_checksum;
}

__attribute__((export_name("run_real_simulation"))) double run_real_simulation(uint32_t seed, double field_seed_override, int32_t requested_balls, int32_t steps) {
  initialize_real_simulation(seed, field_seed_override, requested_balls);
  step_real_simulation(steps);
  return finish_real_simulation();
}

static double ball_cost_for_count(int32_t count) {
  double cost = 300.0;
  for (int32_t index = 1; index < count; index += 1) cost *= BALL_COST_GROWTH;
  return ceil(cost);
}

__attribute__((export_name("add_ball"))) int32_t add_ball(void) {
  if (ball_count >= MAX_BALLS || score < ball_cost_for_count(ball_count)) return 0;
  int32_t index = ball_count;
  double spawn_angle = index * 2.2 + 0.4;
  double direction = rng_next() * TAU;
  score -= ball_cost_for_count(ball_count);
  BALL_X[index] = cos(spawn_angle) * 0.22;
  BALL_Y[index] = sin(spawn_angle) * 0.22;
  BALL_VX[index] = cos(direction) * INITIAL_BALL_SPEED;
  BALL_VY[index] = sin(direction) * INITIAL_BALL_SPEED;
  BALL_HIT_COOLDOWN[index] = 0.0;
  BALL_CORROSIVE_WAKE_CHARGED[index] = 0;
  BALL_NEXT_SEED_AT[index] = germination_unlocked ? simulation_time + next_seed_interval() : 0.0;
  ball_count += 1;
  return 1;
}

__attribute__((export_name("set_tech_resonance_state"))) void set_tech_resonance_state(int32_t enabled) {
  resonance_unlocked = enabled ? 1 : 0;
}

__attribute__((export_name("set_tech_chosen_one_state"))) void set_tech_chosen_one_state(int32_t enabled) {
  chosen_one_unlocked = enabled ? 1 : 0;
}

__attribute__((export_name("set_tech_corrosive_wake_state"))) void set_tech_corrosive_wake_state(int32_t enabled) {
  corrosive_wake_unlocked = enabled && chosen_one_unlocked ? 1 : 0;
}

// Legacy New Growth exports are retained as compatibility shims for older
// front ends. They now address Corrosive Wake; the old growth implementation
// itself remains inactive and available for future repurposing.
__attribute__((export_name("set_tech_new_growth_state"))) void set_tech_new_growth_state(int32_t enabled) {
  corrosive_wake_unlocked = enabled && chosen_one_unlocked ? 1 : 0;
}

__attribute__((export_name("set_tech_conduction_state"))) void set_tech_conduction_state(int32_t enabled) {
  conduction_unlocked = enabled && resonance_unlocked ? 1 : 0;
}

__attribute__((export_name("set_tech_germination_state"))) void set_tech_germination_state(int32_t enabled) {
  germination_unlocked = enabled ? 1 : 0;
}

__attribute__((export_name("set_tech_chosen_one"))) int32_t set_tech_chosen_one(int32_t enabled) {
  if (enabled) {
    if (chosen_one_unlocked || score < CHOSEN_ONE_COST) return 0;
    score -= CHOSEN_ONE_COST;
    chosen_one_unlocked = 1;
    return 1;
  }
  if (!chosen_one_unlocked) return 0;
  if (corrosive_wake_unlocked) return 0;
  score += CHOSEN_ONE_COST;
  chosen_one_unlocked = 0;
  return 1;
}

__attribute__((export_name("set_tech_corrosive_wake"))) int32_t set_tech_corrosive_wake(int32_t enabled) {
  if (enabled) {
    if (!chosen_one_unlocked || corrosive_wake_unlocked || score < CORROSIVE_WAKE_COST) return 0;
    score -= CORROSIVE_WAKE_COST;
    corrosive_wake_unlocked = 1;
    return 1;
  }
  if (!corrosive_wake_unlocked) return 0;
  score += CORROSIVE_WAKE_COST;
  corrosive_wake_unlocked = 0;
  return 1;
}

__attribute__((export_name("set_tech_new_growth"))) int32_t set_tech_new_growth(int32_t enabled) {
  return set_tech_corrosive_wake(enabled);
}

__attribute__((export_name("set_tech_resonance"))) int32_t set_tech_resonance(int32_t enabled) {
  if (enabled) {
    if (resonance_unlocked || score < RESONANCE_COST) return 0;
    score -= RESONANCE_COST;
    resonance_unlocked = 1;
    return 1;
  }
  if (!resonance_unlocked) return 0;
  if (conduction_unlocked) return 0;
  score += RESONANCE_COST;
  resonance_unlocked = 0;
  return 1;
}

__attribute__((export_name("set_tech_conduction"))) int32_t set_tech_conduction(int32_t enabled) {
  if (enabled) {
    if (!resonance_unlocked || conduction_unlocked || score < CONDUCTION_COST) return 0;
    score -= CONDUCTION_COST;
    conduction_unlocked = 1;
    return 1;
  }
  if (!conduction_unlocked) return 0;
  score += CONDUCTION_COST;
  conduction_unlocked = 0;
  return 1;
}

__attribute__((export_name("set_tech_germination"))) int32_t set_tech_germination(int32_t enabled) {
  if (enabled) {
    if (germination_unlocked || score < GERMINATION_COST) return 0;
    score -= GERMINATION_COST;
    germination_unlocked = 1;
    clear_seeds();
    schedule_seed_timers();
    return 1;
  }
  if (!germination_unlocked) return 0;
  score += GERMINATION_COST;
  germination_unlocked = 0;
  clear_seeds();
  for (int32_t ball = 0; ball < ball_count; ball += 1) BALL_NEXT_SEED_AT[ball] = 0.0;
  return 1;
}

__attribute__((export_name("set_simulation_meta"))) void set_simulation_meta(double time, double next_score, int32_t hits, int32_t breaks, double break_rate) {
  simulation_time = time;
  score = next_score;
  total_hits = hits;
  total_breaks = breaks;
  recent_break_rate = break_rate;
}

__attribute__((export_name("set_score"))) void set_score(double next_score) { score = next_score; }

__attribute__((export_name("set_random_state"))) void set_random_state(uint32_t state) { rng_state = state ? state : 0x9e3779b9u; }
__attribute__((export_name("set_next_impact_id"))) void set_next_impact_id(int32_t id) { next_impact_id = id > 0 ? id : 1; }
__attribute__((export_name("set_ball_state"))) void set_ball_state(int32_t index, double x, double y, double vx, double vy, double cooldown) {
  if (index < 0 || index >= MAX_BALLS) return;
  BALL_X[index] = x; BALL_Y[index] = y; BALL_VX[index] = vx; BALL_VY[index] = vy; BALL_HIT_COOLDOWN[index] = cooldown;
}
__attribute__((export_name("set_ball_next_seed_at"))) void set_ball_next_seed_at(int32_t index, double next_time) {
  if (index < 0 || index >= MAX_BALLS) return;
  BALL_NEXT_SEED_AT[index] = next_time >= 0.0 ? next_time : 0.0;
}
__attribute__((export_name("clear_seeds"))) void clear_seed_state(void) { clear_seeds(); }
__attribute__((export_name("set_seed_state"))) void set_seed_state(int32_t index, int32_t shard, double growth, double charge) {
  if (index < 0 || index >= MAX_SEEDS || shard < 0 || shard >= shard_count || seed_index_for_shard(shard) >= 0) return;
  if (index >= seed_count) seed_count = index + 1;
  SEED_SHARD[index] = shard;
  SEED_GROWTH[index] = growth < 0.0 ? 0.0 : growth > 1.0 ? 1.0 : growth;
  SEED_CHARGE[index] = charge < 0.0 ? 0.0 : charge > 1.0 ? 1.0 : charge;
}
__attribute__((export_name("set_ball_corrosive_wake_charge"))) void set_ball_corrosive_wake_charge(int32_t index, int32_t charged) {
  if (index < 0 || index >= MAX_BALLS) return;
  BALL_CORROSIVE_WAKE_CHARGED[index] = charged ? 1 : 0;
}
__attribute__((export_name("contain_ball"))) void contain_ball_state(int32_t index) { contain_ball(index); }
__attribute__((export_name("set_all_shards_broken"))) void set_all_shards_broken(int32_t broken) {
  for (int32_t index = 0; index < shard_count; index += 1) {
    SHARD_BROKEN[index] = POINT_COUNT[index] < 3 ? 1 : (broken ? 1 : 0);
    if (broken) {
      SHARD_GROWTH[index] = 0.0;
      SHARD_GROWING[index] = 0;
      SHARD_GROWTH_PENDING[index] = 0;
    }
  }
}
__attribute__((export_name("set_shard_broken"))) void set_shard_broken(int32_t shard, int32_t broken) {
  if (shard >= 0 && shard < shard_count) {
    SHARD_BROKEN[shard] = POINT_COUNT[shard] < 3 ? 1 : (broken ? 1 : 0);
    if (broken) {
      SHARD_GROWTH[shard] = 0.0;
      SHARD_GROWING[shard] = 0;
      SHARD_GROWTH_PENDING[shard] = 0;
    }
  }
}
__attribute__((export_name("set_shard_growth"))) void set_shard_growth(int32_t shard, double growth, int32_t growing) {
  if (shard < 0 || shard >= shard_count) return;
  SHARD_GROWTH[shard] = growth < 0.0 ? 0.0 : growth > 1.0 ? 1.0 : growth;
  SHARD_GROWING[shard] = growing && SHARD_BROKEN[shard] ? 1 : 0;
  SHARD_GROWTH_PENDING[shard] = 0;
  if (SHARD_GROWING[shard]) mark_shard_damaged(shard);
}
__attribute__((export_name("set_shard_health"))) void set_shard_health(int32_t shard, double health, double updated_at) {
  if (shard < 0 || shard >= shard_count) return;
  SHARD_HEALTH[shard] = health; SHARD_HEALTH_UPDATED_AT[shard] = updated_at;
  if (health < 1.0) mark_shard_damaged(shard);
}
__attribute__((export_name("clear_shard_impacts"))) void clear_shard_impacts(int32_t shard) {
  if (shard >= 0 && shard < shard_count) SHARD_IMPACT_COUNT[shard] = 0;
}
__attribute__((export_name("set_shard_impact"))) void set_shard_impact(int32_t shard, int32_t impact, int32_t id, double x, double y, double inward_x, double inward_y, double strength) {
  if (shard < 0 || shard >= shard_count || impact < 0 || impact >= MAX_IMPACTS) return;
  int32_t offset = shard * MAX_IMPACTS + impact;
  SHARD_IMPACT_ID[offset] = id; SHARD_IMPACT_X[offset] = x; SHARD_IMPACT_Y[offset] = y;
  SHARD_IMPACT_INWARD_X[offset] = inward_x; SHARD_IMPACT_INWARD_Y[offset] = inward_y; SHARD_IMPACT_STRENGTH[offset] = strength;
  if (impact >= SHARD_IMPACT_COUNT[shard]) SHARD_IMPACT_COUNT[shard] = impact + 1;
  mark_shard_damaged(shard);
}

__attribute__((export_name("get_score"))) double get_score(void) { return score; }
__attribute__((export_name("get_tech_chosen_one"))) int32_t get_tech_chosen_one(void) { return chosen_one_unlocked; }
__attribute__((export_name("get_tech_corrosive_wake"))) int32_t get_tech_corrosive_wake(void) { return corrosive_wake_unlocked; }
__attribute__((export_name("get_tech_new_growth"))) int32_t get_tech_new_growth(void) { return corrosive_wake_unlocked; }
__attribute__((export_name("get_tech_resonance"))) int32_t get_tech_resonance(void) { return resonance_unlocked; }
__attribute__((export_name("get_tech_conduction"))) int32_t get_tech_conduction(void) { return conduction_unlocked; }
__attribute__((export_name("get_tech_germination"))) int32_t get_tech_germination(void) { return germination_unlocked; }
__attribute__((export_name("get_total_hits"))) int32_t get_total_hits(void) { return total_hits; }
__attribute__((export_name("get_total_breaks"))) int32_t get_total_breaks(void) { return total_breaks; }
__attribute__((export_name("get_shard_count"))) int32_t get_shard_count(void) { return shard_count; }
__attribute__((export_name("get_field_seed"))) double get_field_seed(void) { return current_field_seed; }
__attribute__((export_name("get_random_state"))) uint32_t get_random_state(void) { return rng_state; }
__attribute__((export_name("get_next_impact_id"))) int32_t get_next_impact_id(void) { return next_impact_id; }
__attribute__((export_name("get_time"))) double get_time(void) { return simulation_time; }
__attribute__((export_name("get_recent_break_rate"))) double get_recent_break_rate(void) { return recent_break_rate; }
__attribute__((export_name("get_ball_count"))) int32_t get_ball_count(void) { return ball_count; }
__attribute__((export_name("get_ball_next_seed_at"))) double get_ball_next_seed_at(int32_t index) { return index >= 0 && index < ball_count ? BALL_NEXT_SEED_AT[index] : 0.0; }
__attribute__((export_name("get_seed_count"))) int32_t get_seed_count(void) { return seed_count; }
__attribute__((export_name("get_seed_shard"))) int32_t get_seed_shard(int32_t index) { return index >= 0 && index < seed_count ? SEED_SHARD[index] : -1; }
__attribute__((export_name("get_seed_growth"))) double get_seed_growth(int32_t index) { return index >= 0 && index < seed_count ? SEED_GROWTH[index] : 0.0; }
__attribute__((export_name("get_seed_charge"))) double get_seed_charge(int32_t index) { return index >= 0 && index < seed_count ? SEED_CHARGE[index] : 0.0; }
__attribute__((export_name("get_event_count"))) int32_t get_event_count(void) { return event_count; }
__attribute__((export_name("get_event_type"))) int32_t get_event_type(int32_t index) { return index >= 0 && index < event_count ? event_type[index] : 0; }
__attribute__((export_name("get_event_shard"))) int32_t get_event_shard(int32_t index) { return index >= 0 && index < event_count ? event_shard[index] : -1; }
__attribute__((export_name("get_event_source_shard"))) int32_t get_event_source_shard(int32_t index) { return index >= 0 && index < event_count ? event_source_shard[index] : -1; }
__attribute__((export_name("get_simulation_runtime_version"))) int32_t get_simulation_runtime_version(void) { return SIMULATION_RUNTIME_VERSION; }
__attribute__((export_name("get_shard_gx"))) int32_t get_shard_gx(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GX[index] : 0; }
__attribute__((export_name("get_shard_gy"))) int32_t get_shard_gy(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GY[index] : 0; }
__attribute__((export_name("get_shard_sx"))) double get_shard_sx(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SX[index] : 0.0; }
__attribute__((export_name("get_shard_sy"))) double get_shard_sy(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SY[index] : 0.0; }
__attribute__((export_name("get_field_boundary_point_count"))) int32_t get_field_boundary_point_count(void) { return field_boundary_point_count; }
__attribute__((export_name("get_field_boundary_point_x"))) double get_field_boundary_point_x(int32_t index) { return index >= 0 && index < field_boundary_point_count ? FIELD_BOUNDARY_X[index] : 0.0; }
__attribute__((export_name("get_field_boundary_point_y"))) double get_field_boundary_point_y(int32_t index) { return index >= 0 && index < field_boundary_point_count ? FIELD_BOUNDARY_Y[index] : 0.0; }
__attribute__((export_name("get_boundary_shard_count"))) int32_t get_boundary_shard_count(void) {
  int32_t count = 0;
  for (int32_t shard = 0; shard < shard_count; shard += 1) if (SHARD_HAS_BOUNDARY_EDGE[shard]) count += 1;
  return count;
}
__attribute__((export_name("get_reachable_boundary_shard_count"))) int32_t get_reachable_boundary_shard_count(void) {
  int32_t count = count_reachable_boundary_shards();
  return count < 0 ? -count : count;
}
__attribute__((export_name("get_shard_hue"))) double get_shard_hue(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HUE[index] : 0.0; }
__attribute__((export_name("get_shard_seed"))) double get_shard_seed(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SEED[index] : 0.0; }
__attribute__((export_name("get_shard_point_count"))) int32_t get_shard_point_count(int32_t index) { return index >= 0 && index < shard_count ? POINT_COUNT[index] : 0; }
__attribute__((export_name("get_shard_point_x"))) double get_shard_point_x(int32_t shard, int32_t point) { return shard >= 0 && shard < shard_count && point >= 0 && point < POINT_COUNT[shard] ? POINT_X[shard * MAX_CELL_POINTS + point] : 0.0; }
__attribute__((export_name("get_shard_point_y"))) double get_shard_point_y(int32_t shard, int32_t point) { return shard >= 0 && shard < shard_count && point >= 0 && point < POINT_COUNT[shard] ? POINT_Y[shard * MAX_CELL_POINTS + point] : 0.0; }
__attribute__((export_name("is_shard_broken"))) int32_t is_shard_broken(int32_t index) { return index >= 0 && index < shard_count ? SHARD_BROKEN[index] : 0; }
__attribute__((export_name("is_shard_boundary_edge"))) int32_t is_shard_boundary_edge(int32_t shard, int32_t edge) {
  return shard >= 0 && shard < shard_count && edge >= 0 && edge < POINT_COUNT[shard]
    ? SHARD_BOUNDARY_EDGE[shard * MAX_CELL_POINTS + edge]
    : 0;
}
__attribute__((export_name("get_shard_health"))) double get_shard_health(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HEALTH[index] : 0.0; }
__attribute__((export_name("get_shard_health_updated_at"))) double get_shard_health_updated_at(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HEALTH_UPDATED_AT[index] : 0.0; }
__attribute__((export_name("get_shard_growth"))) double get_shard_growth(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GROWTH[index] : 0.0; }
__attribute__((export_name("get_shard_growing"))) int32_t get_shard_growing(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GROWING[index] : 0; }
__attribute__((export_name("get_shard_impact_count"))) int32_t get_shard_impact_count(int32_t shard) { return shard >= 0 && shard < shard_count ? SHARD_IMPACT_COUNT[shard] : 0; }
__attribute__((export_name("get_shard_impact_id"))) int32_t get_shard_impact_id(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_ID[shard * MAX_IMPACTS + impact] : 0; }
__attribute__((export_name("get_shard_impact_x"))) double get_shard_impact_x(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_X[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_y"))) double get_shard_impact_y(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_Y[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_inward_x"))) double get_shard_impact_inward_x(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_INWARD_X[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_inward_y"))) double get_shard_impact_inward_y(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_INWARD_Y[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_strength"))) double get_shard_impact_strength(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_STRENGTH[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_arrow_hit_cooldown"))) double get_arrow_hit_cooldown(int32_t index) { return index >= 0 && index < ball_count ? BALL_HIT_COOLDOWN[index] : 0.0; }
__attribute__((export_name("get_ball_corrosive_wake_charge"))) int32_t get_ball_corrosive_wake_charge(int32_t index) { return index >= 0 && index < ball_count ? BALL_CORROSIVE_WAKE_CHARGED[index] : 0; }
__attribute__((export_name("get_corrosive_wake_count"))) int32_t get_corrosive_wake_count(void) { return corrosive_wake_segment_count; }
__attribute__((export_name("get_corrosive_wake_start_x"))) double get_corrosive_wake_start_x(int32_t index) { return index >= 0 && index < corrosive_wake_segment_count ? CORROSIVE_WAKE_START_X[index] : 0.0; }
__attribute__((export_name("get_corrosive_wake_start_y"))) double get_corrosive_wake_start_y(int32_t index) { return index >= 0 && index < corrosive_wake_segment_count ? CORROSIVE_WAKE_START_Y[index] : 0.0; }
__attribute__((export_name("get_corrosive_wake_end_x"))) double get_corrosive_wake_end_x(int32_t index) { return index >= 0 && index < corrosive_wake_segment_count ? CORROSIVE_WAKE_END_X[index] : 0.0; }
__attribute__((export_name("get_corrosive_wake_end_y"))) double get_corrosive_wake_end_y(int32_t index) { return index >= 0 && index < corrosive_wake_segment_count ? CORROSIVE_WAKE_END_Y[index] : 0.0; }
__attribute__((export_name("get_corrosive_wake_age"))) double get_corrosive_wake_age(int32_t index) { return index >= 0 && index < corrosive_wake_segment_count ? CORROSIVE_WAKE_AGE[index] : 0.0; }
__attribute__((export_name("get_ball_x"))) double get_ball_x(int32_t index) { return index >= 0 && index < ball_count ? BALL_X[index] : 0.0; }
__attribute__((export_name("get_ball_y"))) double get_ball_y(int32_t index) { return index >= 0 && index < ball_count ? BALL_Y[index] : 0.0; }
__attribute__((export_name("get_ball_vx"))) double get_ball_vx(int32_t index) { return index >= 0 && index < ball_count ? BALL_VX[index] : 0.0; }
__attribute__((export_name("get_ball_vy"))) double get_ball_vy(int32_t index) { return index >= 0 && index < ball_count ? BALL_VY[index] : 0.0; }
