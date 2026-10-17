<?php
declare(strict_types=1);

class CardDefinitions {
    public const SET_RULES = [
        'brown' => ['size' => 2, 'rent' => [1, 2], 'color' => '#8B4513', 'name' => 'Brown'],
        'dark_blue' => ['size' => 2, 'rent' => [3, 8], 'color' => '#00008B', 'name' => 'Dark Blue'],
        'green' => ['size' => 3, 'rent' => [2, 4, 7], 'color' => '#228B22', 'name' => 'Green'],
        'yellow' => ['size' => 3, 'rent' => [2, 4, 6], 'color' => '#FFD700', 'name' => 'Yellow'],
        'red' => ['size' => 3, 'rent' => [2, 3, 6], 'color' => '#DC143C', 'name' => 'Red'],
        'orange' => ['size' => 3, 'rent' => [1, 3, 5], 'color' => '#FF8C00', 'name' => 'Orange'],
        'pink' => ['size' => 3, 'rent' => [1, 2, 4], 'color' => '#FF69B4', 'name' => 'Pink'],
        'light_blue' => ['size' => 3, 'rent' => [1, 2, 3], 'color' => '#87CEEB', 'name' => 'Light Blue'],
        'railroad' => ['size' => 4, 'rent' => [1, 2, 3, 4], 'color' => '#4A4A4A', 'name' => 'Railroad'],
        'utility' => ['size' => 2, 'rent' => [1, 2], 'color' => '#708090', 'name' => 'Utility'],
    ];

    /**
     * Builds and returns a fresh 106-card deck.
     */
    public static function createDeck(): array {
        $deck = [];
        $id = 1;

        // Money Cards
        $moneyCounts = [1 => 6, 2 => 5, 3 => 3, 4 => 3, 5 => 2, 10 => 1];
        foreach ($moneyCounts as $val => $count) {
            for ($i = 0; $i < $count; $i++) {
                $deck[] = [
                    'id' => 'card_' . ($id++),
                    'type' => 'money',
                    'name' => "\${$val}M Money",
                    'value' => $val,
                    'colors' => [],
                ];
            }
        }

        // Standard Property Cards
        $properties = [
            'brown' => ['Mediterranean Avenue', 'Baltic Avenue'],
            'dark_blue' => ['Boardwalk', 'Park Place'],
            'green' => ['North Carolina Avenue', 'Pacific Avenue', 'Pennsylvania Avenue'],
            'yellow' => ['Atlantic Avenue', 'Ventnor Avenue', 'Marvin Gardens'],
            'red' => ['Illinois Avenue', 'Indiana Avenue', 'Kentucky Avenue'],
            'orange' => ['New York Avenue', 'St. James Place', 'Tennessee Avenue'],
            'pink' => ['St. Charles Place', 'States Avenue', 'Virginia Avenue'],
            'light_blue' => ['Connecticut Avenue', 'Oriental Avenue', 'Vermont Avenue'],
            'railroad' => ['Reading Railroad', 'Pennsylvania Railroad', 'B. & O. Railroad', 'Short Line'],
            'utility' => ['Electric Company', 'Water Works'],
        ];

        $propertyValues = [
            'brown' => 1, 'dark_blue' => 4, 'green' => 4, 'yellow' => 3,
            'red' => 3, 'orange' => 2, 'pink' => 2, 'light_blue' => 1,
            'railroad' => 2, 'utility' => 2,
        ];

        foreach ($properties as $group => $names) {
            foreach ($names as $name) {
                $deck[] = [
                    'id' => 'card_' . ($id++),
                    'type' => 'property',
                    'name' => $name,
                    'value' => $propertyValues[$group],
                    'group' => $group,
                    'colors' => [$group],
                ];
            }
        }

        // Wildcard Properties
        $dualWilds = [
            ['dark_blue', 'green', 4],
            ['utility', 'railroad', 2],
            ['utility', 'railroad', 2],
            ['pink', 'orange', 2],
            ['pink', 'orange', 2],
            ['red', 'yellow', 3],
            ['red', 'yellow', 3],
            ['light_blue', 'brown', 1],
            ['light_blue', 'railroad', 4],
            ['green', 'railroad', 4],
            ['green', 'railroad', 4],
        ];

        foreach ($dualWilds as $dw) {
            $deck[] = [
                'id' => 'card_' . ($id++),
                'type' => 'wild_property',
                'name' => 'Wild Property (' . self::SET_RULES[$dw[0]]['name'] . ' / ' . self::SET_RULES[$dw[1]]['name'] . ')',
                'value' => $dw[2],
                'colors' => [$dw[0], $dw[1]],
                'current_color' => $dw[0],
            ];
        }

        // 10-Color Wildcards
        for ($i = 0; $i < 2; $i++) {
            $deck[] = [
                'id' => 'card_' . ($id++),
                'type' => 'wild_property',
                'name' => 'Multi-Color Wild Property',
                'value' => 0,
                'colors' => array_keys(self::SET_RULES),
                'current_color' => 'brown',
            ];
        }

        // Action Cards
        $actions = [
            ['action' => 'pass_go', 'name' => 'Pass Go', 'value' => 1, 'count' => 10, 'desc' => 'Draw 2 extra cards.'],
            ['action' => 'just_say_no', 'name' => 'Just Say No', 'value' => 4, 'count' => 3, 'desc' => 'Cancel an action played against you.'],
            ['action' => 'sly_deal', 'name' => 'Sly Deal', 'value' => 3, 'count' => 3, 'desc' => 'Steal a single property.'],
            ['action' => 'forced_deal', 'name' => 'Forced Deal', 'value' => 3, 'count' => 3, 'desc' => 'Swap 1 property with another player.'],
            ['action' => 'deal_breaker', 'name' => 'Deal Breaker', 'value' => 5, 'count' => 2, 'desc' => 'Steal a completed set of properties.'],
            ['action' => 'debt_collector', 'name' => 'Debt Collector', 'value' => 3, 'count' => 3, 'desc' => 'Force any player to pay you $5M.'],
            ['action' => 'birthday', 'name' => "It's My Birthday", 'value' => 2, 'count' => 3, 'desc' => 'All players pay you $2M.'],
            ['action' => 'house', 'name' => 'House', 'value' => 3, 'count' => 3, 'desc' => 'Add to a full set for +$3M rent.'],
            ['action' => 'hotel', 'name' => 'Hotel', 'value' => 4, 'count' => 2, 'desc' => 'Add to a set with a house for +$4M rent.'],
            ['action' => 'double_rent', 'name' => 'Double The Rent', 'value' => 1, 'count' => 2, 'desc' => 'Double rent on your next rent card.'],
        ];

        foreach ($actions as $act) {
            for ($i = 0; $i < $act['count']; $i++) {
                $deck[] = [
                    'id' => 'card_' . ($id++),
                    'type' => 'action',
                    'action' => $act['action'],
                    'name' => $act['name'],
                    'value' => $act['value'],
                    'desc' => $act['desc'],
                    'colors' => [],
                ];
            }
        }

        // Rent Cards
        $rentPairs = [
            ['dark_blue', 'green', 1, 2],
            ['red', 'yellow', 1, 2],
            ['pink', 'orange', 1, 2],
            ['light_blue', 'brown', 1, 2],
            ['railroad', 'utility', 1, 2],
        ];
        foreach ($rentPairs as $rp) {
            for ($i = 0; $i < $rp[3]; $i++) {
                $deck[] = [
                    'id' => 'card_' . ($id++),
                    'type' => 'rent',
                    'name' => 'Rent (' . self::SET_RULES[$rp[0]]['name'] . ' / ' . self::SET_RULES[$rp[1]]['name'] . ')',
                    'value' => $rp[2],
                    'colors' => [$rp[0], $rp[1]],
                ];
            }
        }

        // Multi-color Rent Cards (any color, targets 1 player)
        for ($i = 0; $i < 3; $i++) {
            $deck[] = [
                'id' => 'card_' . ($id++),
                'type' => 'rent_wild',
                'name' => 'Wild Rent (Any Color)',
                'value' => 3,
                'colors' => array_keys(self::SET_RULES),
            ];
        }

        shuffle($deck);
        return $deck;
    }
}
