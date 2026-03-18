import math

def calculate_distance(lat1, lon1, lat2, lon2):
    # Haversine formula
    R = 6371  # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def get_recommendations(user_lat, user_lng, workers, category=None):
    """
    Rule-based recommendation system.
    Scores workers based on distance (60%) and rating (40%).
    """
    scored_workers = []
    
    for worker in workers:
        if category and worker.get('skill', '').lower() != category.lower():
            continue
            
        dist = calculate_distance(user_lat, user_lng, worker.get('lat', 0), worker.get('lng', 0))
        rating = worker.get('rating', 0)
        
        # Scoring logic: 
        # Lower distance is better (normalized to 10km max for scoring)
        # Higher rating is better
        dist_score = max(0, (10 - dist) / 10) * 60
        rating_score = (rating / 5) * 40
        
        total_score = dist_score + rating_score
        
        worker_copy = dict(worker)
        worker_copy['distance'] = round(dist, 2)
        worker_copy['score'] = round(total_score, 2)
        scored_workers.append(worker_copy)
    
    # Sort by score descending
    return sorted(scored_workers, key=lambda x: x['score'], reverse=True)
