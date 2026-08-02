#include <stdint.h>

// This is a freestanding, C-compatible C++ implementation of the full simulation.
// It intentionally keeps the same data-oriented layout as the C version.

#define GRID_MIN (-45)
#define GRID_MAX 45
#define GRID_SIZE 91
#define GRID_CELLS (GRID_SIZE * GRID_SIZE)
#define MAX_SHARDS 10000
#define MAX_CELL_POINTS 32
#define MAX_IMPACTS 64
#define MAX_BALLS 256
#define MAX_EVENTS_PER_STEP 1024

#define CELL_SIZE 1.0
#define TAU 6.283185307179586476925286766559
#define BASE_BALL_RADIUS 0.095
#define INITIAL_BALL_SPEED 1.4366976021418008
#define SHARD_MAX_HEALTH 1.0
#define BASE_HIT_DAMAGE 0.2
#define SHARD_REGENERATION_RATE 0.01
#define HEALTH_EPSILON 0.000000001
#define INITIAL_BALL_COST 300.0
#define BALL_COST_GROWTH 1.2
#define RESONANCE_COST 10000.0
#define RESONANCE_SPLASH_DAMAGE 0.05
#define BOUNCE_JITTER_RADIANS (0.02 * 3.1415926535897932384626433832795 / 180.0)
#define COLLISION_SEPARATION 0.004
#define MAX_COLLISIONS_PER_STEP 4
#define FIXED_TIMESTEP (1.0 / 60.0)
#define RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS 60.0

extern "C" {
extern double sin(double);
extern double cos(double);
extern double sqrt(double);
extern double exp(double);
extern double floor(double);
extern double ceil(double);
}

static double POINT_X[MAX_SHARDS * MAX_CELL_POINTS];
static double POINT_Y[MAX_SHARDS * MAX_CELL_POINTS];
static int32_t POINT_COUNT[MAX_SHARDS];
static double CENTER_X[MAX_SHARDS];
static double CENTER_Y[MAX_SHARDS];
static int32_t GRID[GRID_CELLS];
static int32_t SHARD_GX[MAX_SHARDS];
static int32_t SHARD_GY[MAX_SHARDS];
static double SHARD_SX[MAX_SHARDS];
static double SHARD_SY[MAX_SHARDS];
static double SHARD_HEALTH[MAX_SHARDS];
static double SHARD_HEALTH_UPDATED_AT[MAX_SHARDS];
static double SHARD_HUE[MAX_SHARDS];
static double SHARD_SEED[MAX_SHARDS];
static int32_t SHARD_BROKEN[MAX_SHARDS];
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
static int32_t resonance_unlocked;
static int32_t event_count;
static int32_t event_type[MAX_EVENTS_PER_STEP];
static int32_t event_shard[MAX_EVENTS_PER_STEP];
static double last_score;
static int32_t last_hits;
static int32_t last_breaks;
static int32_t last_shards;
static double last_checksum;

static const double HEXAGON_X[6] = {1.0, 0.5, -0.5, -1.0, -0.5, 0.5};
static const double HEXAGON_Y[6] = {0.0, 0.8660254037844386, 0.8660254037844386, 0.0, -0.8660254037844386, -0.8660254037844386};

static int32_t abs_i32(int32_t value) { return value < 0 ? -value : value; }

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

static double rng_next(void) {
  rng_state = rng_state * 1664525u + 1013904223u;
  return (double)rng_state / 4294967296.0;
}

static void site_for(int32_t gx, int32_t gy, double field_seed, double *x, double *y) {
  if (gx == 0 && gy == 0) {
    *x = 0.0;
    *y = 0.0;
    return;
  }
  double angle = seeded_hash((double)gx + 18.4, (double)gy - 7.1, field_seed) * TAU;
  double radius = sqrt(seeded_hash((double)gx - 4.2, (double)gy + 21.8, field_seed)) * 0.78;
  *x = gx * CELL_SIZE + cos(angle) * radius + sin(gx * 0.71 + gy * 1.17) * 0.075;
  *y = gy * CELL_SIZE + sin(angle) * radius + cos(gx * 1.09 - gy * 0.53) * 0.075;
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
  int32_t polygon_count = 4;
  polygon_x[0] = *sx - 2.1; polygon_y[0] = *sy - 2.1;
  polygon_x[1] = *sx + 2.1; polygon_y[1] = *sy - 2.1;
  polygon_x[2] = *sx + 2.1; polygon_y[2] = *sy + 2.1;
  polygon_x[3] = *sx - 2.1; polygon_y[3] = *sy + 2.1;

  for (int32_t neighbor_y = gy - 4; neighbor_y <= gy + 4; neighbor_y += 1) {
    for (int32_t neighbor_x = gx - 4; neighbor_x <= gx + 4; neighbor_x += 1) {
      if (neighbor_x == gx && neighbor_y == gy) continue;
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

  if (polygon_count < 3) {
    polygon_count = 4;
    polygon_x[0] = *sx - 0.42; polygon_y[0] = *sy - 0.42;
    polygon_x[1] = *sx + 0.42; polygon_y[1] = *sy - 0.42;
    polygon_x[2] = *sx + 0.42; polygon_y[2] = *sy + 0.42;
    polygon_x[3] = *sx - 0.42; polygon_y[3] = *sy + 0.42;
  }
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

static void mark_shard_damaged(int32_t shard) {
  if (SHARD_DAMAGED[shard]) return;
  SHARD_DAMAGED[shard] = 1;
  DAMAGED_SHARDS[damaged_shard_count++] = shard;
}

static void record_event(int32_t type, int32_t shard) {
  if (event_count >= MAX_EVENTS_PER_STEP) return;
  event_type[event_count] = type;
  event_shard[event_count] = shard;
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
    if (SHARD_BROKEN[shard] || (SHARD_IMPACT_COUNT[shard] == 0 && SHARD_HEALTH[shard] >= 1.0)) {
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
    record_event(3, shard);
  }
}

static void apply_resonance(int32_t source) {
  if (!resonance_unlocked) return;
  int32_t source_gx = SHARD_GX[source];
  int32_t source_gy = SHARD_GY[source];
  for (int32_t gy = source_gy - 2; gy <= source_gy + 2; gy += 1) {
    for (int32_t gx = source_gx - 2; gx <= source_gx + 2; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t neighbor = GRID[grid_index(gx, gy)];
      if (neighbor < 0 || neighbor == source || SHARD_BROKEN[neighbor]) continue;
      double shared_x, shared_y, inward_x, inward_y;
      if (!shared_edge_for_shards(source, neighbor, &shared_x, &shared_y, &inward_x, &inward_y)) continue;
      record_event(2, neighbor);
      damage_shard(neighbor, RESONANCE_SPLASH_DAMAGE, shared_x, shared_y, inward_x, inward_y, 0);
    }
  }
}

static void initialize_field(double field_seed) {
  shard_count = 0;
  current_field_seed = field_seed;
  damaged_shard_count = 0;
  for (int32_t index = 0; index < GRID_CELLS; index += 1) GRID[index] = -1;
  for (int32_t gy = GRID_MIN; gy <= GRID_MAX; gy += 1) {
    for (int32_t gx = GRID_MIN; gx <= GRID_MAX; gx += 1) {
      if (sqrt((double)gx * gx + (double)gy * gy) > 48.0) continue;
      int32_t shard = shard_count++;
      int32_t grid_slot = grid_index(gx, gy);
      GRID[grid_slot] = shard;
      SHARD_GX[shard] = gx;
      SHARD_GY[shard] = gy;
      int32_t point_start = shard * MAX_CELL_POINTS;
      POINT_COUNT[shard] = build_cell(gx, gy, field_seed, &SHARD_SX[shard], &SHARD_SY[shard], POINT_X + point_start, POINT_Y + point_start);
      CENTER_X[shard] = SHARD_SX[shard];
      CENTER_Y[shard] = SHARD_SY[shard];
      SHARD_HEALTH[shard] = SHARD_MAX_HEALTH;
      SHARD_HEALTH_UPDATED_AT[shard] = 0.0;
      SHARD_SEED[shard] = seeded_hash((double)gx + 4.8, (double)gy - 2.3, field_seed);
      SHARD_HUE[shard] = 162.0 + seeded_hash((double)gx + 4.8, (double)gy - 2.3, field_seed) * 72.0 + sqrt((double)gx * gx + (double)gy * gy) * 2.2;
      SHARD_BROKEN[shard] = circle_intersects_polygon(0.0, 0.0, BASE_BALL_RADIUS, shard);
      SHARD_IMPACT_COUNT[shard] = 0;
      SHARD_DAMAGED[shard] = 0;
    }
  }
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
  resonance_unlocked = 0;
  event_count = 0;

  double initial_direction = rng_next() * TAU;
  BALL_X[0] = 0.0;
  BALL_Y[0] = 0.0;
  BALL_VX[0] = cos(initial_direction) * INITIAL_BALL_SPEED;
  BALL_VY[0] = sin(initial_direction) * INITIAL_BALL_SPEED;
  BALL_HIT_COOLDOWN[0] = 0.0;
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
    ball_count += 1;
  }
}

typedef struct {
  int32_t valid;
  int32_t shard;
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

static void consider_collision(Collision *best, int32_t shard, double time, double point_x, double point_y, double normal_x, double normal_y) {
  if (time < -0.000001 || time > 1.000001 || (best->valid && time >= best->time)) return;
  best->valid = 1;
  best->shard = shard;
  best->time = time < 0.0 ? 0.0 : time > 1.0 ? 1.0 : time;
  best->point_x = point_x;
  best->point_y = point_y;
  best->normal_x = normal_x;
  best->normal_y = normal_y;
}

static Collision collision_for(double x, double y, double next_x, double next_y, double radius) {
  Collision best = {0, -1, 0.0, 0.0, 0.0, 0.0, 0.0};
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

  for (int32_t gy = min_y; gy <= max_y; gy += 1) {
    for (int32_t gx = min_x; gx <= max_x; gx += 1) {
      if (!in_grid(gx, gy)) continue;
      int32_t shard = GRID[grid_index(gx, gy)];
      if (shard < 0 || SHARD_BROKEN[shard]) continue;
      int32_t count = POINT_COUNT[shard];
      int32_t start = shard * MAX_CELL_POINTS;
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
          consider_collision(&best, shard, 0.0, nearest_start.point_x, nearest_start.point_y, start_normal_x, start_normal_y);
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
        consider_collision(&best, shard, 1.0, nearest_end.point_x, nearest_end.point_y, end_normal_x, end_normal_y);
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
        consider_collision(&best, shard, time, ax + edge_x * projection, ay + edge_y * projection, -inward_x, -inward_y);
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
          consider_collision(&best, shard, root, vertex_x, vertex_y, normal_x / normal_length, normal_y / normal_length);
        }
      }
    }
  }
  return best;
}

static void step_simulation(void) {
  simulation_time += FIXED_TIMESTEP;
  recent_break_rate *= exp(-FIXED_TIMESTEP / RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS);
  event_count = 0;
  for (int32_t ball = 0; ball < ball_count; ball += 1) {
    BALL_HIT_COOLDOWN[ball] -= FIXED_TIMESTEP;
    if (BALL_HIT_COOLDOWN[ball] < 0.0) BALL_HIT_COOLDOWN[ball] = 0.0;
    double remaining = FIXED_TIMESTEP;
    int32_t collision_count = 0;
    while (remaining > 0.000001 && collision_count < MAX_COLLISIONS_PER_STEP) {
      double next_x = BALL_X[ball] + BALL_VX[ball] * remaining;
      double next_y = BALL_Y[ball] + BALL_VY[ball] * remaining;
      Collision collision = collision_for(BALL_X[ball], BALL_Y[ball], next_x, next_y, BASE_BALL_RADIUS);
      if (!collision.valid) {
        BALL_X[ball] = next_x;
        BALL_Y[ball] = next_y;
        break;
      }
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
        record_event(1, collision.shard);
        if (BALL_HIT_COOLDOWN[ball] <= 0.0) {
          damage_shard(collision.shard, BASE_HIT_DAMAGE, collision.point_x, collision.point_y, -collision.normal_x, -collision.normal_y, 1);
          BALL_HIT_COOLDOWN[ball] = 0.14;
        }
        apply_resonance(collision.shard);
      }
      remaining *= (1.0 - collision.time) > 0.0 ? 1.0 - collision.time : 0.0;
      collision_count += 1;
    }
  }
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
  ball_count += 1;
  return 1;
}

__attribute__((export_name("set_tech_resonance_state"))) void set_tech_resonance_state(int32_t enabled) {
  resonance_unlocked = enabled ? 1 : 0;
}

__attribute__((export_name("set_tech_resonance"))) int32_t set_tech_resonance(int32_t enabled) {
  if (enabled) {
    if (resonance_unlocked || score < RESONANCE_COST) return 0;
    score -= RESONANCE_COST;
    resonance_unlocked = 1;
    return 1;
  }
  if (!resonance_unlocked) return 0;
  score += RESONANCE_COST;
  resonance_unlocked = 0;
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
__attribute__((export_name("set_all_shards_broken"))) void set_all_shards_broken(int32_t broken) {
  for (int32_t index = 0; index < shard_count; index += 1) SHARD_BROKEN[index] = broken ? 1 : 0;
}
__attribute__((export_name("set_shard_broken"))) void set_shard_broken(int32_t shard, int32_t broken) {
  if (shard >= 0 && shard < shard_count) SHARD_BROKEN[shard] = broken ? 1 : 0;
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
__attribute__((export_name("get_tech_resonance"))) int32_t get_tech_resonance(void) { return resonance_unlocked; }
__attribute__((export_name("get_total_hits"))) int32_t get_total_hits(void) { return total_hits; }
__attribute__((export_name("get_total_breaks"))) int32_t get_total_breaks(void) { return total_breaks; }
__attribute__((export_name("get_shard_count"))) int32_t get_shard_count(void) { return shard_count; }
__attribute__((export_name("get_field_seed"))) double get_field_seed(void) { return current_field_seed; }
__attribute__((export_name("get_random_state"))) uint32_t get_random_state(void) { return rng_state; }
__attribute__((export_name("get_next_impact_id"))) int32_t get_next_impact_id(void) { return next_impact_id; }
__attribute__((export_name("get_time"))) double get_time(void) { return simulation_time; }
__attribute__((export_name("get_recent_break_rate"))) double get_recent_break_rate(void) { return recent_break_rate; }
__attribute__((export_name("get_ball_count"))) int32_t get_ball_count(void) { return ball_count; }
__attribute__((export_name("get_event_count"))) int32_t get_event_count(void) { return event_count; }
__attribute__((export_name("get_event_type"))) int32_t get_event_type(int32_t index) { return index >= 0 && index < event_count ? event_type[index] : 0; }
__attribute__((export_name("get_event_shard"))) int32_t get_event_shard(int32_t index) { return index >= 0 && index < event_count ? event_shard[index] : -1; }
__attribute__((export_name("get_shard_gx"))) int32_t get_shard_gx(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GX[index] : 0; }
__attribute__((export_name("get_shard_gy"))) int32_t get_shard_gy(int32_t index) { return index >= 0 && index < shard_count ? SHARD_GY[index] : 0; }
__attribute__((export_name("get_shard_sx"))) double get_shard_sx(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SX[index] : 0.0; }
__attribute__((export_name("get_shard_sy"))) double get_shard_sy(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SY[index] : 0.0; }
__attribute__((export_name("get_shard_hue"))) double get_shard_hue(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HUE[index] : 0.0; }
__attribute__((export_name("get_shard_seed"))) double get_shard_seed(int32_t index) { return index >= 0 && index < shard_count ? SHARD_SEED[index] : 0.0; }
__attribute__((export_name("get_shard_point_count"))) int32_t get_shard_point_count(int32_t index) { return index >= 0 && index < shard_count ? POINT_COUNT[index] : 0; }
__attribute__((export_name("get_shard_point_x"))) double get_shard_point_x(int32_t shard, int32_t point) { return shard >= 0 && shard < shard_count && point >= 0 && point < POINT_COUNT[shard] ? POINT_X[shard * MAX_CELL_POINTS + point] : 0.0; }
__attribute__((export_name("get_shard_point_y"))) double get_shard_point_y(int32_t shard, int32_t point) { return shard >= 0 && shard < shard_count && point >= 0 && point < POINT_COUNT[shard] ? POINT_Y[shard * MAX_CELL_POINTS + point] : 0.0; }
__attribute__((export_name("is_shard_broken"))) int32_t is_shard_broken(int32_t index) { return index >= 0 && index < shard_count ? SHARD_BROKEN[index] : 0; }
__attribute__((export_name("get_shard_health"))) double get_shard_health(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HEALTH[index] : 0.0; }
__attribute__((export_name("get_shard_health_updated_at"))) double get_shard_health_updated_at(int32_t index) { return index >= 0 && index < shard_count ? SHARD_HEALTH_UPDATED_AT[index] : 0.0; }
__attribute__((export_name("get_shard_impact_count"))) int32_t get_shard_impact_count(int32_t shard) { return shard >= 0 && shard < shard_count ? SHARD_IMPACT_COUNT[shard] : 0; }
__attribute__((export_name("get_shard_impact_id"))) int32_t get_shard_impact_id(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_ID[shard * MAX_IMPACTS + impact] : 0; }
__attribute__((export_name("get_shard_impact_x"))) double get_shard_impact_x(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_X[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_y"))) double get_shard_impact_y(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_Y[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_inward_x"))) double get_shard_impact_inward_x(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_INWARD_X[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_inward_y"))) double get_shard_impact_inward_y(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_INWARD_Y[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_shard_impact_strength"))) double get_shard_impact_strength(int32_t shard, int32_t impact) { return shard >= 0 && shard < shard_count && impact >= 0 && impact < SHARD_IMPACT_COUNT[shard] ? SHARD_IMPACT_STRENGTH[shard * MAX_IMPACTS + impact] : 0.0; }
__attribute__((export_name("get_arrow_hit_cooldown"))) double get_arrow_hit_cooldown(int32_t index) { return index >= 0 && index < ball_count ? BALL_HIT_COOLDOWN[index] : 0.0; }
__attribute__((export_name("get_ball_x"))) double get_ball_x(int32_t index) { return index >= 0 && index < ball_count ? BALL_X[index] : 0.0; }
__attribute__((export_name("get_ball_y"))) double get_ball_y(int32_t index) { return index >= 0 && index < ball_count ? BALL_Y[index] : 0.0; }
__attribute__((export_name("get_ball_vx"))) double get_ball_vx(int32_t index) { return index >= 0 && index < ball_count ? BALL_VX[index] : 0.0; }
__attribute__((export_name("get_ball_vy"))) double get_ball_vy(int32_t index) { return index >= 0 && index < ball_count ? BALL_VY[index] : 0.0; }
